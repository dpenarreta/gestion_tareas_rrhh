import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoPredictivePayloadToNexoShape } from "@/lib/djangoPredictiveAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ userId: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `TrendEngineView` (backend, Fase 9) — mismo patrón que
// `analytics/[userId]/route.ts`. `weeksBack` se reenvía como `weeks_back`
// (único campo con nombre distinto en todo Inteligencia Preventiva; la
// validación de rango 1-52 ya vive en Django, réplica no necesaria acá).
export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const weeksBack = request.nextUrl.searchParams.get("weeksBack");
  const query = weeksBack ? `?weeks_back=${encodeURIComponent(weeksBack)}` : "";

  const response = await djangoApiFetch(`/predictive/trend/${userId}/${query}`);
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
    return NextResponse.json({ error: "Error al obtener el Trend Engine" }, { status: response.status });
  }

  const payload = mapDjangoPredictivePayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
