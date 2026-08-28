import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ userId: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// ~70 líneas de composición sobre el motor central (ya portado a Django
// desde la Fase 16) a un reenvío directo. `getSession()` se mantiene solo
// para el 401 — la visibilidad jerárquica real (404/403) vive en
// `InsightsView` (backend), mismo patrón que `analytics/[userId]/route.ts`
// (Fase 4m).
export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;

  const response = await djangoApiFetch(`/analytics/insights/${userId}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener Insights" }, { status: response.status });
  }

  const payload = mapDjangoAnalyticsPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
