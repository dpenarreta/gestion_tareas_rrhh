// Roster de colaboradores incluidos en un Executive Report — misma fuente
// para los 3 tipos de reporte y para los 3 alcances que el motor soporta de
// forma nativa (consolidado/por área/individual — ver snapshotData.ts §
// SnapshotRosterKind): NO son builders distintos, son este mismo roster
// invocado con filtros distintos (ExecutiveReportFilters).
import { prisma } from "@/lib/prisma";
import { getVisibleRoles, isLeadershipRole } from "@/lib/roles";
import type { Role, ReportScope } from "@/generated/prisma/client";
import type { ExecutiveReportFilters } from "./filters";
import type { SnapshotRosterKind } from "./snapshotData";

export type ReportRosterUser = { id: string; name: string; role: Role };

export type ResolvedReportRoster = {
  users: ReportRosterUser[];
  userIds: string[];
  scope: ReportScope;
  rosterKind: SnapshotRosterKind;
};

/**
 * Los roles de liderazgo (Administrador, Jefe Nacional) nunca son SUJETOS de
 * un reporte consolidado, sin importar quién lo genera (Sprint 0A,
 * `isLeadershipRole` en roles.ts) — dirigen, no ejecutan tareas operativas.
 * Para los 3 roles habilitados a generar reportes (`CAN_ACCESS_REPORTS`),
 * `getVisibleRoles(role)` ya coincide exactamente con "todos los roles
 * no-liderazgo" (verificado antes de este sprint — ver docs/AUDIT_LOG.md).
 *
 * `filters.roles`/`filters.areas`/`filters.colaboradores` solo NARROWAN ese
 * roster ya seguro — nunca pueden ampliarlo más allá de lo que la jerarquía
 * del generador permite ver, sin importar lo que el caller pida.
 */
export async function resolveReportRoster(
  session: { role: Role },
  filters: Pick<ExecutiveReportFilters, "roles" | "areas" | "colaboradores">,
): Promise<ResolvedReportRoster> {
  const visibleRoles = getVisibleRoles(session.role);
  let allowedRoles: Role[] = visibleRoles.filter((r) => !isLeadershipRole(r));

  if (filters.roles && filters.roles.length > 0) {
    const requested = new Set(filters.roles);
    allowedRoles = allowedRoles.filter((r) => requested.has(r));
  }
  // "área" es alias de rol hasta que exista un campo de área propio — ver filters.ts.
  if (filters.areas && filters.areas.length > 0) {
    const requestedAreas = new Set(filters.areas as Role[]);
    allowedRoles = allowedRoles.filter((r) => requestedAreas.has(r));
  }

  const requestedUserIds = filters.colaboradores && filters.colaboradores.length > 0 ? filters.colaboradores : null;

  const users = await prisma.user.findMany({
    where: {
      role: { in: allowedRoles },
      ...(requestedUserIds ? { id: { in: requestedUserIds } } : {}),
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  const scope: ReportScope = session.role === "JEFE_NACIONAL" || session.role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";

  const narrowedByRoleOrArea = Boolean((filters.roles && filters.roles.length > 0) || (filters.areas && filters.areas.length > 0));
  const rosterKind: SnapshotRosterKind = requestedUserIds
    ? requestedUserIds.length === 1
      ? "INDIVIDUAL"
      : "POR_AREA"
    : narrowedByRoleOrArea
      ? "POR_AREA"
      : "CONSOLIDADO";

  return { users, userIds: users.map((u) => u.id), scope, rosterKind };
}
