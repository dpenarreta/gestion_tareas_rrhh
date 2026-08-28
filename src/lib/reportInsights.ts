import type { WorkloadLabel } from "@/components/kpis/types";
import { classifyEstadoOperativo, type EstadoOperativoResult } from "@/lib/analytics";

/**
 * Motor de interpretación de Informes Ejecutivos (Sprint Reportes
 * Ejecutivos 2.0) — capa de composición sobre datos ya calculados por
 * `analytics.ts`/`workload.ts` (o, desde las Fases 67-73, por el bundle
 * de Django que reemplazó esos cálculos — ver
 * `src/lib/executiveReporting/djangoReportKpisBridge.ts`). NUNCA recalcula
 * un KPI ni usa IA: cada función de aquí es una regla fija sobre números
 * que otro módulo ya produjo. El "Análisis IA" (Groq) del reporte es un
 * módulo aparte, independiente de este — ver `docs/DECISIONS.md` § Sprint
 * Reportes Ejecutivos 2.0.
 *
 * Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): se retiraron las funciones
 * que calculaban `TeamMonthlyPoint`/`TrendComparison`/`RiskQuadrant`/
 * `Finding`/`Recommendation`/`IndicatorExplanation` localmente contra
 * Prisma — ese cálculo ya lo hace Django (Fases 67-73,
 * `backend/apps/reports/insights.py`) y llega servido en el bundle. Los
 * TIPOS se conservan intactos: siguen siendo el contrato de forma que
 * `buildSnapshotData.ts`/`snapshotData.ts`/`documentModel.ts`/`nova/*`
 * usan para tipar esos mismos campos ya viniendo de Django.
 */

// El clasificador puro vive en `executiveReporting/indiceEjecutivo.ts` (SIN
// "server-only" — no tiene I/O) para que un Client Component pueda
// importarlo sin arrastrar este archivo completo a su bundle — ver el
// comentario de ese archivo (causa raíz de un fallo real de build,
// docs/AUDIT_LOG.md § Fix Índice Ejecutivo). Se reexporta aquí solo para no
// romper a los consumidores existentes (`buildSnapshotData.ts`,
// `report-insights.test.ts`) — código nuevo que necesite
// `classifyIndiceEjecutivo` desde un contexto potencialmente cliente debe
// importarlo de `executiveReporting/indiceEjecutivo.ts` directamente, nunca
// de aquí.
export { classifyIndiceEjecutivo, type IndiceEjecutivoNivel, type IndiceEjecutivoResult } from "@/lib/executiveReporting/indiceEjecutivo";

// ── Tipos servidos hoy por Django (Fases 67-73) — el cálculo se retiró de
// acá, el contrato de forma se conserva. ──

export type TeamMonthlyPoint = {
  month: string;
  label: string;
  avgCumplimiento: number;
  avgCargaPct: number;
  totalConsultas: number;
  totalTasks: number;
};

export type TrendComparison = {
  label: string;
  currentValue: number;
  compareValue: number | null;
  delta: number | null;
  direction: "mejora" | "deterioro" | "estable" | "sin-datos";
};

export type RiskQuadrant = "criticos" | "atencion-carga" | "atencion-cumplimiento" | "saludables";

export type Finding = { text: string; tone: "positive" | "risk" | "neutral" };
/**
 * `id` es estable por regla (no un cuid aleatorio) — Executive Reporting
 * Engine 2.0 lo usa para que NOVA enriquezca 1:1 esta lista sin poder
 * inventar recomendaciones nuevas (ver src/lib/executiveReporting/nova).
 */
export type Recommendation = { id: string; text: string; priority: "alta" | "media" };

export type IndicatorExplanation = { meaning: string; why: string; impact: string; action: string };

// ── Bloque 10 — Insights ────────────────────────────────────────────────────

export function computeTeamInsights(input: {
  members: Array<{ name: string; cargaRealHours: number }>;
  totalCargaRealHours: number;
  healthByMember?: Array<{ name: string; score: number }>;
  variableConsistencyMembers?: string[];
}): string[] {
  const insights: string[] = [];

  if (input.totalCargaRealHours > 0 && input.members.length > 0) {
    const top = [...input.members].sort((a, b) => b.cargaRealHours - a.cargaRealHours)[0];
    const pct = Math.round((top.cargaRealHours / input.totalCargaRealHours) * 100);
    if (pct >= 20) insights.push(`${top.name} concentró el ${pct}% del tiempo ejecutado por el equipo este período.`);
  }

  if (input.healthByMember && input.healthByMember.length > 0) {
    const best = [...input.healthByMember].sort((a, b) => b.score - a.score)[0];
    insights.push(`${best.name} mantiene el mayor Equilibrio Operativo del equipo (${best.score}/100).`);
  }

  for (const name of (input.variableConsistencyMembers ?? []).slice(0, 2)) {
    insights.push(`${name} presenta variaciones importantes entre semanas.`);
  }

  return insights;
}

// ── Sprint Analytics 2.1 — Bloque 9: Estado del Colaborador ────────────────
// Reutiliza LITERALMENTE classifyEstadoOperativo (analytics.ts) — nunca
// inventa tramos nuevos. Cuando el informe es del mes calendario en curso ya
// existe un Equilibrio Operativo real (equilibrioScore, motor completo con
// Capacidad Futura) — se clasifica ese valor tal cual. Para cualquier otro
// período (mes pasado, trimestre/semestre/año, rango personalizado) NO se
// invoca el motor: mismo criterio que Índice Ejecutivo/Tendencias (ver
// docs/DECISIONS.md § Sprint Reportes Ejecutivos 2.0) — Capacidad Futura es
// una proyección hacia adelante desde "ahora", no representativa de un
// período ya cerrado. En su lugar se deriva un puntaje aproximado 0-100 a
// partir de datos YA calculados por el informe (cumplimiento, zona de carga,
// vencidas) y se clasifica con los MISMOS 5 tramos.

export type MemberEstadoInput = {
  completedPct: number;
  cargaLabel: WorkloadLabel;
  overdueCount: number;
  /** Equilibrio Operativo real (0-100) — solo presente en informes del mes calendario en curso. */
  equilibrioScore?: number;
};

const CARGA_LABEL_SCORE: Record<WorkloadLabel, number> = {
  "Óptimo": 100,
  "Moderado": 80,
  "Carga elevada": 60,
  "Subutilización": 30,
  "Sobrecarga": 30,
};

export function deriveEstadoOperativo(m: MemberEstadoInput): EstadoOperativoResult {
  if (m.equilibrioScore !== undefined) return classifyEstadoOperativo(m.equilibrioScore);
  const vencidasPenalty = Math.min(30, m.overdueCount * 10);
  const approxScore = Math.max(0, Math.round(m.completedPct * 0.5 + CARGA_LABEL_SCORE[m.cargaLabel] * 0.5 - vencidasPenalty));
  return classifyEstadoOperativo(approxScore);
}

// ── Sprint Analytics 2.1 — Bloque 10: Principal Hallazgo ────────────────────
// Un único hallazgo predominante por colaborador, reglas fijas (sin IA),
// prioridad de mayor a menor severidad operativa. `consistencyVariable` y
// `capacidadLimitada` son opcionales porque dependen de señales que solo se
// calculan para el mes calendario en curso (mismo motivo que Bloque 9) — si
// el caller no las provee, esos dos tramos simplemente se omiten.

export type MemberHallazgoInput = {
  cargaLabel: WorkloadLabel;
  completedPct: number;
  overdueCount: number;
  totalTasks: number;
  consistencyVariable?: boolean;
  capacidadLimitada?: boolean;
};

export const PRINCIPAL_HALLAZGO_LABEL = {
  sinDatos: "Sin actividad registrada",
  sobrecarga: "Sobrecarga",
  subutilizacion: "Subutilización",
  capacidadLimitada: "Capacidad limitada",
  retrasosRecurrentes: "Retrasos recurrentes",
  consistenciaBaja: "Consistencia baja",
  sinTareasVencidas: "Sin tareas vencidas",
  cargaEquilibrada: "Carga equilibrada",
} as const;

export function computePrincipalHallazgo(m: MemberHallazgoInput): string {
  if (m.totalTasks === 0) return PRINCIPAL_HALLAZGO_LABEL.sinDatos;
  if (m.cargaLabel === "Sobrecarga") return PRINCIPAL_HALLAZGO_LABEL.sobrecarga;
  if (m.cargaLabel === "Subutilización") return PRINCIPAL_HALLAZGO_LABEL.subutilizacion;
  if (m.capacidadLimitada) return PRINCIPAL_HALLAZGO_LABEL.capacidadLimitada;
  if (m.overdueCount > 0) return PRINCIPAL_HALLAZGO_LABEL.retrasosRecurrentes;
  if (m.consistencyVariable) return PRINCIPAL_HALLAZGO_LABEL.consistenciaBaja;
  if (m.completedPct >= 80) return PRINCIPAL_HALLAZGO_LABEL.sinTareasVencidas;
  return PRINCIPAL_HALLAZGO_LABEL.cargaEquilibrada;
}
