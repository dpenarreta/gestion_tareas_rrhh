// Puente hacia el motor de CÁLCULO de Reportes Ejecutivos de Django
// (`apps.reports.member_kpis`/`insights`/`team_report`, Fases 64-71 de la
// migración de stack, ver docs/AUDIT_LOG.md § 2026-08-26) — cutover HTTP
// real del bloque `ReportMemberKpi` + agregados de equipo de
// `buildSnapshotData.ts` (parte (2) de las "3 partes que faltan del motor
// de cálculo"). Verificado campo por campo con datos sintéticos idénticos
// en Postgres y Django contra `buildSnapshotData.ts` real antes de este
// cutover (Fases 70/71) — incluidos los casos de borde de mes de
// RANGO_MESES.
//
// Fuera de alcance de este puente, deliberadamente — el caller sigue
// resolviendo estas piezas sin cambios: Índice Ejecutivo (Fase 57, puente
// aparte en `djangoAnalyticsBridge.ts`), Analytics Predictivo
// (`predictionEngine.ts`), narrativa NOVA, `insights` (`computeTeamInsights`
// sigue en TS porque necesita `healthByMember`/`variableConsistencyMembers`
// del Índice Ejecutivo, que este bundle no calcula), y
// `estadoOperativo`/`principalHallazgo` por miembro del builder MENSUAL
// (dependen del `equilibrioScore` de ese mismo Índice Ejecutivo).
//
// Decisión de comportamiento (confirmada explícitamente con el usuario,
// ver docs/AUDIT_LOG.md § 2026-08-26): si Django no responde o responde con
// error, la generación del reporte FALLA (se lanza una excepción) — a
// diferencia del Índice Ejecutivo (que degrada excluyendo colaboradores sin
// romper la generación), `ReportMemberKpi` es el corazón visible del
// reporte, no un agregado secundario. Los `userIds` que llegan a este
// puente son el id numérico de Django directo (roster ya resuelto por
// `resolveRoster.ts` — retiro del bridge cuid↔Django, decisión explícita
// del usuario, ver docs/AUDIT_LOG.md § 2026-08-31), sin traducción
// intermedia.
import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, chr: string) => chr.toUpperCase());
}

function deepCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCamelCase);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [snakeToCamel(key), deepCamelCase(v)]),
    );
  }
  return value;
}

async function postTeamReport(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await djangoApiFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!response || !response.ok) {
    throw new Error(`No se pudo calcular el reporte vía Django (${path}, status ${response?.status ?? "sin respuesta"})`);
  }
  return deepCamelCase(await response.json()) as Record<string, unknown>;
}

/** Bundle del builder MENSUAL — réplica del subconjunto de `ExecutiveReportSnapshotData` que `apps.reports.team_report.assemble_monthly_team_report` sí calcula (ver docstring del módulo Django para el límite exacto). */
export async function fetchMonthlyTeamReport(
  userIds: string[],
  year: number,
  month: number,
  fechaCorte?: Date,
): Promise<Record<string, unknown>> {
  return postTeamReport("/reports/executive/monthly-team-kpis/", {
    user_ids: userIds.map(Number),
    year,
    month,
    fecha_corte: fechaCorte?.toISOString(),
  });
}

/** Bundle del builder RANGO PERSONALIZADO. */
export async function fetchCustomRangeTeamReport(
  userIds: string[],
  periodStart: Date,
  periodEnd: Date,
  fechaCorte?: Date,
): Promise<Record<string, unknown>> {
  return postTeamReport("/reports/executive/custom-range-team-kpis/", {
    user_ids: userIds.map(Number),
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    fecha_corte: fechaCorte?.toISOString(),
  });
}

/** Bundle del builder RANGO DE MESES — `monthlyEvolution[i].memberSnapshots` llega como objeto `{djangoId: {...}}` (Fase 66/71, sin identidad — ver `member_kpis.py`), se resuelve aparte en `buildRangeSnapshotData` porque necesita convertirse a array con `id`/`name`/`role`, no un simple remapeo de `id`. */
export async function fetchRangeTeamReport(
  userIds: string[],
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number,
  fechaCorte?: Date,
): Promise<Record<string, unknown>> {
  return postTeamReport("/reports/executive/range-team-kpis/", {
    user_ids: userIds.map(Number),
    from_year: fromYear,
    from_month: fromMonth,
    to_year: toYear,
    to_month: toMonth,
    fecha_corte: fechaCorte?.toISOString(),
  });
}

/**
 * Fase 89 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica del último
 * `prisma.monthlyReport.findUnique` de `buildSnapshotData.ts` (variación
 * del Índice Ejecutivo contra el mes anterior). `null` si no existe (hoy
 * SIEMPRE, porque nada escribe `MonthlyReport` — ver docstring del
 * modelo Django). A diferencia de `postTeamReport`, `data` NO pasa por
 * `deepCamelCase`: es un JSON escrito por el propio Next.js legacy en
 * camelCase directo, no una respuesta serializada por Django.
 */
export async function fetchDjangoMonthlyReport(month: number, year: number, scope: string): Promise<unknown | null> {
  const response = await djangoApiFetch(`/reports/monthly-report/?month=${month}&year=${year}&scope=${scope}`);
  if (!response || !response.ok) return null;
  const body = (await response.json()) as { data: unknown };
  return body.data;
}
