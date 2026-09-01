import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, ANALYTICS_BUNDLE_TIMEOUT_MS } from "@/lib/djangoSession";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";

// Fase 4m de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-12):
// cortado a Django. `getSession()` se mantiene solo para el 401 — la
// visibilidad jerárquica real (404/403) y la redacción admin-only de
// `validationWarnings` viven en `AnalyticsBundleView`/`build_analytics_
// bundle_payload` (`backend/apps/analytics/views.py`/`services.py`).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;

  let response;
  try {
    response = await djangoApiFetch(`/analytics/${userId}/`, {}, ANALYTICS_BUNDLE_TIMEOUT_MS);
  } catch {
    // Timeout (`AbortSignal`) u otro fallo de red no traducible a un status
    // HTTP — ver `ANALYTICS_BUNDLE_TIMEOUT_MS` en djangoSession.ts.
    return NextResponse.json({ error: "El cálculo de Analytics está tardando más de lo esperado. Intenta de nuevo en unos segundos." }, { status: 504 });
  }
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
    return NextResponse.json({ error: "Error al obtener Analytics" }, { status: response.status });
  }

  const payload = mapDjangoAnalyticsPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
