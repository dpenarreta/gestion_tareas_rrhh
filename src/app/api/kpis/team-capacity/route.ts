import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoKpiPayloadToNexoShape } from "@/lib/djangoKpisAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `TeamCapacityView` (backend, Fase 19) — excluye roles de liderazgo
// (`get_subordinate_executor_groups`), a diferencia de `apps.team`
// (Fase 18, sin ese filtro).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/kpis/team-capacity/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener la capacidad del equipo" }, { status: response.status });
  }

  const payload = mapDjangoKpiPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
