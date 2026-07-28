// Executive Reporting Engine 2.0 — objeto de dominio único del reporte.
//
// Principio de arquitectura (directriz explícita del Sprint): "Analytics
// calcula una vez. Executive Reporting consume una vez. Todo lo demás
// únicamente presenta esa información." `ExecutiveReportSnapshotData` es ESA
// única consumición — la construyen exclusivamente las funciones de
// `buildSnapshotData.ts` (que sí llaman a `analytics.ts`/`reportInsights.ts`/
// Prisma), y a partir de aquí en adelante NINGÚN módulo del motor de
// reportes (páginas de pantalla, render a HTML/PDF, render a Excel, contexto
// de NOVA, auditoría) vuelve a consultar Analytics ni a recalcular un
// indicador — todos leen únicamente de esta estructura ya congelada.
//
// Es el mismo objeto para las 4 combinaciones de alcance/origen que debe
// soportar el motor:
//   - alcance: CONSOLIDADO (roster completo) | POR_AREA (roster filtrado por
//     rol/zona) | INDIVIDUAL (roster de un solo colaborador) — NO son builders
//     distintos, son el mismo builder invocado con un `collaboratorIds`
//     distinto (ver resolveRoster.ts). `meta.rosterKind` solo documenta cuál
//     de los tres fue.
//   - origen: GENERATED (recién calculado) | LEGACY_MIGRATION (adaptado desde
//     un MonthlyReport histórico en el backfill de una sola corrida, Fase D)
//     — un snapshot LEGACY puede traer campos ausentes cuando el dato viejo no
//     permite reconstruirlos (ver ExecutiveReportSnapshot.integrityFlag).
//
// Cada campo documenta qué página/sección del FPS (Parte II) o qué consumidor
// posterior (NOVA en Fase C, render en Fase E, auditoría en Fase D/F) lo lee.
import type {
  ReportMemberKpi,
  MotivoDistributionItem,
  IndiceEjecutivoData,
  MonthSnapshot,
} from "@/components/kpis/types";
import type { TrendComparison, RiskQuadrant, Finding, Recommendation, IndicatorExplanation } from "@/lib/reportInsights";
import type { DataQualityResult } from "@/lib/analytics";
import type {
  ExecutiveReportType,
  ExecutiveReportPeriodStatus,
  ExecutiveReportOrigin,
  ExecutiveReportIntegrity,
  ReportScope,
} from "@/generated/prisma/client";

/**
 * El mismo builder cubre "reporte consolidado", "por área" e "individual" —
 * la única diferencia real es el roster (`collaboratorIds`) con el que se
 * invoca (ver resolveRoster.ts). Este campo es puramente descriptivo, para
 * que la Portada/Metadatos puedan decir qué clase de alcance tuvo el reporte.
 */
export type SnapshotRosterKind = "CONSOLIDADO" | "POR_AREA" | "INDIVIDUAL";

/** Versiones mostradas en Portada/Metadatos (FPS Parte IV §10) — ver executiveReporting/version.ts, única fuente de estos valores. */
export type SnapshotVersions = {
  analyticsEngineVersion: string;
  formulaSetVersion: string;
  reportingEngineVersion: string;
  nexoVersion: string;
};

/** Quién generó el reporte — para Portada/Metadatos y para ExecutiveReportAuditLog (Fase D/F). */
export type SnapshotGeneratedBy = { userId: string; name: string };

/**
 * § Portada / § Metadatos (última página) — identidad y trazabilidad
 * completa del reporte (FPS Parte IV §3/§4/§9/§10). Se genera DENTRO del
 * builder (no se espera a la capa de persistencia de la Fase D): `reportId`
 * ya viene resuelto aquí, y el objeto completo se congela (Object.freeze
 * profundo) antes de devolverse — ningún consumidor puede modificar un
 * snapshot ya construido.
 */
export type SnapshotMeta = {
  /** NXR-YYYYMMDD-HHMMSS-XXXX — ver executiveReporting/reportId.ts. Generado aquí, no en la capa de persistencia. */
  reportId: string;
  /** GENERATED para todo snapshot construido por estos builders; LEGACY_MIGRATION solo lo produce el backfill de la Fase D, que no pasa por aquí. */
  origin: ExecutiveReportOrigin;
  /** FULL para todo snapshot construido por estos builders (con datos completos); PARTIAL es exclusivo de adaptaciones LEGACY. */
  integrityFlag: ExecutiveReportIntegrity;
  type: ExecutiveReportType;
  rosterKind: SnapshotRosterKind;
  scope: ReportScope;
  periodLabel: string;
  /** ISO 8601. */
  periodStart: string;
  /** ISO 8601. */
  periodEnd: string;
  /** ISO 8601 — "fecha de corte" (FPS Parte IV §5): toda la data de este objeto está calculada únicamente hasta esta fecha (parámetro `fechaCorte` de ExecutiveReportFilters, o su valor por defecto si se omitió). */
  fechaCorte: string;
  periodStatus: ExecutiveReportPeriodStatus;
  collaboratorIds: string[];
  collaboratorCount: number;
  generatedBy: SnapshotGeneratedBy;
  /** ISO 8601 — instante real de generación (distinto de `fechaCorte`, que es el límite de los datos, no de cuándo se generó el documento). */
  generatedAt: string;
  /** Milisegundos que tomó construir este snapshot completo (FPS Parte IV §8 — presupuesto de rendimiento). */
  generationMs: number;
  versions: SnapshotVersions;
};

export type SnapshotTeamAlert = {
  userId: string;
  name: string;
  type: "cumplimiento" | "sobrecarga";
  value: number;
  /** Solo presente en reportes multi-mes (RANGO_MESES) — meses activos donde persistió el problema (≥50%). */
  monthsAffected?: number;
};

/** § Estado General del Equipo / § Portada (tarjeta central) — teamSummary base, sin narrativa. */
export type SnapshotTeamSummary = {
  avgCumplimiento: number;
  avgCargaPct: number;
  totalCargaRealHours: number;
  totalCargaBaseHours: number;
  totalCompletedTasks: number;
  totalConsultas: number;
  totalTasks: number;
  hoursPerDay: number;
  cargaRangeMin: number;
  cargaRangeMax: number;
};

/**
 * § Portada (Estado General + Semáforo Ejecutivo) y § Estado General del
 * Equipo — `dataQuality` viene EXCLUSIVAMENTE de `analytics.computeDataQuality`
 * (FPS Parte IV §11: la calidad del dato nunca se calcula en el módulo de
 * reportes) — se llama una única vez por generación, aquí, no en cada page.
 */
export type SnapshotEstadoGeneral = {
  indiceEjecutivo: IndiceEjecutivoData;
  dataQuality: DataQualityResult;
};

/** § Distribución Operativa — cada distribución ya trae su propia interpretación (ver `explainMotivoDistribution`); el render solo la presenta, nunca la deriva. */
export type SnapshotDistribuciones = {
  consultasByReason: MotivoDistributionItem[];
  riskQuadrant: Array<{ id: string; name: string; completedPct: number; cargaPct: number; quadrant: RiskQuadrant }>;
};

/**
 * § Analytics Predictivo — integración visual del motor EXISTENTE
 * (`predictionEngine.ts`, por colaborador — sin fórmulas nuevas, sin motor
 * de escenarios de equipo nuevo). Solo se calcula para el mes calendario en
 * curso (mismo criterio que Índice Ejecutivo — una proyección hacia
 * adelante no es representativa de un mes ya cerrado); `null` en cualquier
 * otro caso (rango de meses, rango personalizado, mes pasado) — la página
 * correspondiente debe degradar con un mensaje, nunca fallar (FPS Parte IV
 * §8: la narrativa nunca bloquea la generación).
 */
export type SnapshotPredictiveMember = {
  id: string;
  name: string;
  cumplimiento: { available: boolean; queOcurrira: string; porQue: string; queHacer: string[]; confidencePct: number } | null;
  sobrecarga: { available: boolean; queOcurrira: string; porQue: string; nivel: "Alto" | "Medio" | "Bajo"; queHacer: string[]; confidencePct: number } | null;
  subutilizacion: { nivel: "Alto" | "Medio" | "Bajo"; queOcurrira: string; queHacer: string[] } | null;
};

export type SnapshotPredictivo = {
  /** ISO 8601 — instante desde el que se proyecta (el mismo "ahora" usado por el motor, no la fecha de corte). */
  asOf: string;
  horizonDays: number;
  membersAtRiskSobrecarga: number;
  avgCumplimientoEsperadoCierrePct: number | null;
  members: SnapshotPredictiveMember[];
} | null;

/**
 * § Executive Summary / § Executive Insights / § Executive Assessment by NOVA
 * / § Recomendaciones (enriquecimiento) / § Analytics Predictivo (narrativa
 * de escenarios) — llenado por `generateExecutiveNarrative` (Fase C). Nunca
 * es `null` en un snapshot GENERATED (siempre hay, al menos, la variante
 * determinista de fallback) — `null` queda reservado para snapshots
 * `LEGACY_MIGRATION` cuyo `MonthlyReport.aiAnalysis` original era texto
 * libre, no estructurado (ver backfill, Fase D).
 */
export type SnapshotNova = import("./nova/types").NovaSections | null;

/**
 * Objeto de dominio único del Executive Reporting Engine 2.0. Se construye
 * UNA vez por generación (`buildMonthlySnapshotData` /
 * `buildRangeSnapshotData` / `buildCustomRangeSnapshotData`), se persiste
 * inmutable en `ExecutiveReportSnapshot.data` (Fase D), y es la ÚNICA fuente
 * de la que se derivan: las páginas en pantalla y el HTML/PDF (Fase E), el
 * libro Excel (Fase E), el contexto de NOVA (Fase C) y los campos de
 * auditoría/metadatos (Fase D/F). Ningún consumidor posterior debe volver a
 * llamar a Prisma ni a `analytics.ts` para obtener algo que ya está aquí.
 */
export type ExecutiveReportSnapshotData = {
  /** § Portada, § Metadatos. */
  meta: SnapshotMeta;
  /** § Portada (tarjeta Estado General + Semáforo Ejecutivo), § Estado General del Equipo. */
  estadoGeneral: SnapshotEstadoGeneral;
  /** § Estado General del Equipo, § Portada. */
  teamSummary: SnapshotTeamSummary;
  /** § Detalle por Colaborador. */
  members: ReportMemberKpi[];
  /** § Indicadores Estratégicos (ranking). */
  ranking: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  /** § Distribución Operativa. */
  distribuciones: SnapshotDistribuciones;
  /** § Estado General del Equipo (tarjetas de tendencia) — solo MENSUAL; `null` en RANGO_MESES/RANGO_PERSONALIZADO. */
  trends: { mesAnterior: TrendComparison; trimestre: TrendComparison; semestre: TrendComparison } | null;
  /** § Distribución Operativa / § Executive Insights (evolución mes a mes) — solo RANGO_MESES. */
  monthlyEvolution: MonthSnapshot[] | null;
  /** § Executive Insights (tendencia general del rango) — solo RANGO_MESES. */
  rangeTrend: {
    cumplimientoTrend: "mejora" | "deterioro" | "estancamiento";
    cumplimientoChange: number;
    firstMonthAvgCumplimiento: number;
    lastMonthAvgCumplimiento: number;
  } | null;
  /** § Executive Insights — meses con cumplimiento de equipo < 60% — solo RANGO_MESES. */
  problematicMonths: Array<{ month: string; label: string; teamAvgCumplimiento: number }> | null;
  /** § Executive Insights (hallazgos deterministas — base sobre la que NOVA construye sin repetir). */
  findings: Finding[];
  /** § Executive Insights (insights deterministas — base sobre la que NOVA construye sin repetir). */
  insights: string[];
  /** § Estado General del Equipo — Cumplimiento/Carga/Consultas. Equilibrio Operativo/Tareas vencidas/Consistencia/Capacidad se derivan en la Fase E directamente de `members[].estadoOperativo`/`equilibrioScore` (ya presentes abajo) — no son un cálculo nuevo. */
  indicatorExplanations: { cumplimiento: IndicatorExplanation; carga: IndicatorExplanation; consultas: IndicatorExplanation };
  /** § Recomendaciones — base determinista; NOVA (Fase C) solo la enriquece por `id`, nunca agrega ni quita entradas. */
  recommendations: Recommendation[];
  /** § Distribución Operativa / § Executive Insights. */
  alerts: SnapshotTeamAlert[];
  /** § Analytics Predictivo — ver `SnapshotPredictivo`. */
  predictivo: SnapshotPredictivo;
  /** § Executive Summary, § Executive Insights, § Executive Assessment by NOVA, § Recomendaciones, § Analytics Predictivo — ver `SnapshotNova`. */
  nova: SnapshotNova;
  /** true si CUALQUIER sección de `nova` degradó a fallback determinista (sin GROQ_API_KEY, timeout, o respuesta malformada) — nunca bloquea la generación, solo se audita (Fase D/F). */
  novaDegraded: boolean;
};
