import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import type { Role } from "@/lib/roles";
import type { SnapshotRosterKind, ReportScope } from "./executiveReporting/snapshotData";

/**
 * Fase 87 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28).
 * Adaptador de `GET /reports/roster/` (Django, réplica exacta de
 * `resolveReportRoster`) — usado únicamente por
 * `src/lib/executiveReporting/resolveRoster.ts`.
 */

export type DjangoReportRosterUser = { id: string; name: string; role: Role };

export type DjangoReportRoster = {
  users: DjangoReportRosterUser[];
  user_ids: string[];
  scope: ReportScope;
  roster_kind: SnapshotRosterKind;
};

export async function fetchDjangoReportRoster(filters: {
  roles?: Role[];
  areas?: string[];
  colaboradores?: string[];
}): Promise<DjangoReportRoster | null> {
  const params = new URLSearchParams();
  if (filters.roles && filters.roles.length > 0) params.set("roles", filters.roles.join(","));
  if (filters.areas && filters.areas.length > 0) params.set("areas", filters.areas.join(","));
  if (filters.colaboradores && filters.colaboradores.length > 0) params.set("colaboradores", filters.colaboradores.join(","));

  const query = params.toString();
  const response = await djangoApiFetch(`/reports/roster/${query ? `?${query}` : ""}`);
  if (!response || !response.ok) return null;
  return (await response.json()) as DjangoReportRoster;
}
