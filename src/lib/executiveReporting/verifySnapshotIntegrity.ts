// Sprint R — Snapshot Integrity Validation (Fase 79, ver docs/AUDIT_LOG.md
// § 2026-08-27). FPS Parte IV §15 exige que los valores del reporte
// coincidan con Dashboard/Analytics para la misma fecha de corte, y que
// una discrepancia se registre como incidente — validación ACTIVA en
// tiempo de ejecución (vuelve a consultar y comparar al generar), a
// diferencia de la integridad ESTRUCTURAL ya cumplida por diseño (un único
// Builder canónico, un único objeto congelado del que derivan todas las
// vistas — ver docs/AUDIT_LOG.md § 2026-07-28, Decisión 9).
//
// Solo se llama para reportes MENSUAL del mes calendario en curso SIN
// `fechaCorte` explícita (ver `buildMonthlySnapshotData`) — es el único
// caso donde la fuente de comparación (`GET /kpis/team/`, `TeamKpiView`) y
// el motor de reportes (`assemble_monthly_team_report`) están mirando el
// mismo momento: `TeamKpiView` no es consciente de una fecha de corte
// explícita, así que comparar contra reportes históricos/con corte
// generaría discrepancias falsas por diseño, no bugs reales. Tampoco se
// compara el Índice Ejecutivo (`fetchPerformanceAndHealth`) — sería casi
// tautológico, ya usa el mismo endpoint (`/analytics/<id>/`) que este
// builder llama para calcularlo; `TeamKpiView` sí es un camino de cómputo
// Python genuinamente distinto, es la comparación que realmente vale.
//
// Best-effort, nunca lanza — mismo principio que NOVA (FPS Parte IV §8):
// esta validación jamás bloquea ni hace fallar la generación del reporte
// que audita.
import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import type { ReportMemberKpi } from "@/components/kpis/types";

const TOLERANCE_PCT_POINTS = 0.5;

type DjangoTeamKpiRow = {
  id: number;
  completed_pct: number;
  carga_pct: number;
};

export type IntegrityCheckResult = {
  performed: boolean;
  discrepancyCount: number;
};

async function reportIncident(params: {
  reportId: string;
  fieldPath: string;
  expected: number;
  actual: number;
  userId: number | undefined;
}): Promise<void> {
  await djangoApiFetch("/reports/executive/integrity-incidents/", {
    method: "POST",
    body: JSON.stringify({
      report_id: params.reportId,
      field_path: params.fieldPath,
      expected_value: params.expected,
      actual_value: params.actual,
      source: "kpis_team",
      user_id: params.userId ?? null,
    }),
  });
}

export async function verifySnapshotIntegrity(
  reportId: string,
  month: number,
  year: number,
  members: ReportMemberKpi[],
): Promise<IntegrityCheckResult> {
  try {
    const monthParam = `${year}-${String(month).padStart(2, "0")}`;
    const response = await djangoApiFetch(`/kpis/team/?month=${monthParam}`);
    if (!response || !response.ok) return { performed: false, discrepancyCount: 0 };

    const data = (await response.json()) as { users: DjangoTeamKpiRow[] };
    const comparisonByUserId = new Map<string, DjangoTeamKpiRow>();
    for (const row of data.users) {
      comparisonByUserId.set(String(row.id), row);
    }

    let discrepancyCount = 0;
    const pending: Promise<void>[] = [];
    for (const member of members) {
      const comparison = comparisonByUserId.get(member.id);
      if (!comparison) continue;

      const fields: Array<[string, number, number]> = [
        ["completedPct", member.completedPct, comparison.completed_pct],
        ["cargaPct", member.cargaPct, comparison.carga_pct],
      ];
      for (const [field, expected, actual] of fields) {
        if (Math.abs(expected - actual) > TOLERANCE_PCT_POINTS) {
          discrepancyCount++;
          pending.push(
            reportIncident({
              reportId,
              fieldPath: `members[${member.id}].${field}`,
              expected,
              actual,
              userId: Number(member.id),
            }).catch(() => undefined),
          );
        }
      }
    }
    await Promise.all(pending);
    return { performed: true, discrepancyCount };
  } catch {
    return { performed: false, discrepancyCount: 0 };
  }
}
