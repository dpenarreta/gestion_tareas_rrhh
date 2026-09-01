import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, ANALYTICS_BUNDLE_TIMEOUT_MS } from "@/lib/djangoSession";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ userId: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `OperationalRiskView` (backend, Fase 16) — mismo patrón que
// `analytics/insights/[userId]/route.ts`. La visibilidad restringida a
// gerencia (`can_view_operational_risk`, nunca nivel 1) y la jerárquica
// estándar sobre el usuario objetivo viven ambas en Django.
export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;

  let response;
  try {
    // Mismo timeout extendido que `/api/analytics/[userId]` — este endpoint
    // se llama en paralelo con el resto del bundle de Analytics/Nova en la
    // misma carga de página (`OperationalRiskCard.tsx`, `NovaInsights`,
    // resumen ejecutivo, riesgo de equipo…); bajo esa concurrencia el
    // timeout genérico de 3s también lo hace fallar de forma intermitente
    // (ver docs/AUDIT_LOG.md § 2026-08-31).
    response = await djangoApiFetch(`/analytics/operational-risk/${userId}/`, {}, ANALYTICS_BUNDLE_TIMEOUT_MS);
  } catch {
    return NextResponse.json({ error: "El cálculo de Riesgo Operativo está tardando más de lo esperado. Intenta de nuevo en unos segundos." }, { status: 504 });
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
    return NextResponse.json({ error: "Error al obtener Riesgo Operativo" }, { status: response.status });
  }

  const payload = mapDjangoAnalyticsPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
