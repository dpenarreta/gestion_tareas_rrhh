import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoPredictivePayloadToNexoShape } from "@/lib/djangoPredictiveAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `TeamPreventiveAlertsView` (backend, Fase 9b) — subordinados + proyectos
// activos visibles ya resueltos del lado Django (`get_team_members`/
// `get_visible_team_project_ids`).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/predictive/team-alerts/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener las alertas del equipo" }, { status: response.status });
  }

  const payload = mapDjangoPredictivePayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
