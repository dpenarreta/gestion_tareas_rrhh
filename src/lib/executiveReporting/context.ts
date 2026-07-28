// Executive Reporting Engine 2.0 — ExecutiveReportContext: vista derivada y
// condensada de ExecutiveReportSnapshotData, pensada exclusivamente para NOVA
// (Fase C — Executive Summary / Executive Insights / Executive Assessment).
// El Snapshot sigue siendo la ÚNICA fuente de verdad; este Context no agrega
// NINGÚN dato nuevo, solo reordena/condensa lo que el Snapshot ya tiene para
// que NOVA no necesite recorrer `members[]`/`distribuciones`/etc. completos
// para construir sus prompts. `deriveExecutiveReportContext` es una función
// pura (sin I/O) — se llama después de que el snapshot ya está congelado.
import type { ExecutiveReportSnapshotData, SnapshotTeamAlert } from "./snapshotData";
import type { MotivoDistributionItem, IndiceEjecutivoNivel } from "@/components/kpis/types";
import type { Recommendation } from "@/lib/reportInsights";
import { resolveEstadoGeneral } from "./estadoGeneral";

export type ExecutiveReportContextMemberHighlight = {
  id: string;
  name: string;
  role: string;
  score: number;
  completedPct: number;
};

export type ExecutiveReportContext = {
  meta: {
    type: ExecutiveReportSnapshotData["meta"]["type"];
    periodLabel: string;
    fechaCorte: string;
    periodStatus: ExecutiveReportSnapshotData["meta"]["periodStatus"];
    collaboratorCount: number;
  };
  resumen: {
    avgCumplimiento: number;
    avgCargaPct: number;
    totalConsultas: number;
    totalTasks: number;
    totalCompletedTasks: number;
    estadoGeneralNivel: IndiceEjecutivoNivel | null;
    estadoGeneralValor: number | null;
    dataQualityPct: number;
  };
  /** Tendencia mensual (mes anterior/trimestre/semestre) — solo presente en reportes MENSUAL. */
  tendenciaMensual: ExecutiveReportSnapshotData["trends"];
  /** Tendencia de rango (mejora/deterioro/estancamiento) — solo presente en RANGO_MESES. */
  tendenciaRango: ExecutiveReportSnapshotData["rangeTrend"];
  /** Texto ya interpretado — NOVA construye sobre esto, nunca lo repite literalmente. */
  hallazgos: string[];
  insights: string[];
  alertas: SnapshotTeamAlert[];
  /** Top 3 motivos de consulta — suficiente para Insights/Distribución, sin traer la lista completa. */
  distribucionTop: MotivoDistributionItem[];
  /** Lista fija de recomendaciones deterministas — NOVA solo enriquece por `id`, nunca agrega ni quita. */
  recomendaciones: Recommendation[];
  destacado: {
    mejor: ExecutiveReportContextMemberHighlight | null;
    atencion: ExecutiveReportContextMemberHighlight | null;
  };
};

/** Pura — no hace I/O ni recalcula nada; solo reordena datos que ya están en el snapshot congelado. */
export function deriveExecutiveReportContext(snapshot: ExecutiveReportSnapshotData): ExecutiveReportContext {
  const sortedByScore = [...snapshot.members].sort((a, b) => b.score - a.score);
  const mejorMember = sortedByScore[0] ?? null;
  const atencionMember = sortedByScore.length > 1 ? sortedByScore[sortedByScore.length - 1] : null;

  const toHighlight = (m: (typeof sortedByScore)[number]): ExecutiveReportContextMemberHighlight => ({
    id: m.id,
    name: m.name,
    role: m.role,
    score: m.score,
    completedPct: m.completedPct,
  });

  // Mismo constructor que la Portada (`documentModel.ts::buildCoverPage`) —
  // ver estadoGeneral.ts. Antes este contexto leía `indiceEjecutivo` directo
  // (siempre `null` fuera del mes en curso, ver docs/AUDIT_LOG.md § Fix
  // Estado General), así que NOVA narraba un reporte de rango con datos
  // completos como si no tuviera Estado General. "Sin datos para el
  // período" se mapea a `null` para no ensanchar el tipo público de este
  // campo — los fallbacks de NOVA (`nova/fallbacks.ts`) ya degradan con
  // gracia cuando `estadoGeneralNivel` es `null`.
  const estadoGeneral = resolveEstadoGeneral(snapshot);

  return {
    meta: {
      type: snapshot.meta.type,
      periodLabel: snapshot.meta.periodLabel,
      fechaCorte: snapshot.meta.fechaCorte,
      periodStatus: snapshot.meta.periodStatus,
      collaboratorCount: snapshot.meta.collaboratorCount,
    },
    resumen: {
      avgCumplimiento: snapshot.teamSummary.avgCumplimiento,
      avgCargaPct: snapshot.teamSummary.avgCargaPct,
      totalConsultas: snapshot.teamSummary.totalConsultas,
      totalTasks: snapshot.teamSummary.totalTasks,
      totalCompletedTasks: snapshot.teamSummary.totalCompletedTasks,
      estadoGeneralNivel: estadoGeneral.nivel === "Sin datos para el período" ? null : estadoGeneral.nivel,
      estadoGeneralValor: estadoGeneral.valor,
      dataQualityPct: snapshot.estadoGeneral.dataQuality.pct,
    },
    tendenciaMensual: snapshot.trends,
    tendenciaRango: snapshot.rangeTrend,
    hallazgos: snapshot.findings.map((f) => f.text),
    insights: snapshot.insights,
    alertas: snapshot.alerts,
    distribucionTop: snapshot.distribuciones.consultasByReason.slice(0, 3),
    recomendaciones: snapshot.recommendations,
    destacado: {
      mejor: mejorMember ? toHighlight(mejorMember) : null,
      atencion: atencionMember ? toHighlight(atencionMember) : null,
    },
  };
}
