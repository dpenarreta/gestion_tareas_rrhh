// Roster de colaboradores incluidos en un Executive Report — misma fuente
// para los 3 tipos de reporte y para los 3 alcances que el motor soporta de
// forma nativa (consolidado/por área/individual — ver snapshotData.ts §
// SnapshotRosterKind): NO son builders distintos, son este mismo roster
// invocado con filtros distintos (ExecutiveReportFilters).
//
// Cutover de stack — Fase 87 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica
// de `GET /reports/roster/` (Django, `RosterView` — composición sobre
// `get_visible_groups`/`is_executor_group`/`scope_for_role`, ya probadas
// individualmente). Si Django no responde, se lanza (nunca degrada a un
// roster vacío/silencioso) — mismo criterio que el resto del builder de
// Reportes Ejecutivos (Fase 72: "si Django falla, la generación FALLA").
import { fetchDjangoReportRoster } from "@/lib/djangoReportRosterAdapter";
import type { Role } from "@/lib/roles";
import type { ExecutiveReportFilters } from "./filters";
import type { SnapshotRosterKind, ReportScope } from "./snapshotData";

export type ReportRosterUser = { id: string; name: string; role: Role };

export type ResolvedReportRoster = {
  users: ReportRosterUser[];
  userIds: string[];
  scope: ReportScope;
  rosterKind: SnapshotRosterKind;
};

export async function resolveReportRoster(
  _session: { role: Role },
  filters: Pick<ExecutiveReportFilters, "roles" | "areas" | "colaboradores">,
): Promise<ResolvedReportRoster> {
  const roster = await fetchDjangoReportRoster(filters);
  if (!roster) {
    throw new Error("No se pudo resolver el roster del reporte (sesión Django no disponible).");
  }

  return {
    users: roster.users,
    userIds: roster.user_ids,
    scope: roster.scope,
    rosterKind: roster.roster_kind,
  };
}
