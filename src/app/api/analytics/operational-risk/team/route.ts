import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, ANALYTICS_BUNDLE_TIMEOUT_MS } from "@/lib/djangoSession";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `TeamOperationalRiskView` (backend, Fase 20) — la notificación automática
// a los superiores cuando el riesgo de un subordinado es Alto/Crítico
// (deduplicada una vez por persona/mes) ya vive en
// `notify_if_high_risk`, del lado Django.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let response;
  try {
    // Computa Riesgo Operativo para TODO el equipo del actor — más
    // exigente aún que la versión individual, mismo timeout extendido
    // (ver docs/AUDIT_LOG.md § 2026-08-31).
    response = await djangoApiFetch("/analytics/operational-risk/team/", {}, ANALYTICS_BUNDLE_TIMEOUT_MS);
  } catch {
    return NextResponse.json({ error: "El cálculo de Riesgo Operativo del equipo está tardando más de lo esperado. Intenta de nuevo en unos segundos." }, { status: 504 });
  }
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener Riesgo Operativo del equipo" }, { status: response.status });
  }

  const payload = mapDjangoAnalyticsPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
