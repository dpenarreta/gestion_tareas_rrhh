/**
 * Sprint Analytics 2.1 (Bloque 12) — preparación de arquitectura para una
 * futura Comparación de Equipos (áreas/equipos/coordinaciones/zonas). Este
 * módulo NO se conecta a ninguna ruta ni componente todavía — es solo el
 * tipo de datos que un futuro `computeTeamComparison` debería producir, para
 * que cuando se construya no haya que rediseñar la forma de los datos desde
 * cero. No hay cambios de schema: NEXO no tiene hoy un campo de
 * área/equipo/coordinación/zona en `User` — `role` es la única dimensión
 * organizacional existente (p. ej. COORDINADOR_ZS ya sugiere una noción de
 * "zona", pero no hay un campo dedicado). Definir esa dimensión es trabajo
 * de un sprint futuro, con su propia decisión de producto (ver
 * docs/ROADMAP.md § Comparación de Equipos).
 */

export type ComparisonDimension = "area" | "equipo" | "coordinacion" | "zona";

export type TeamComparisonGroup = {
  id: string;
  label: string;
  dimension: ComparisonDimension;
  memberIds: string[];
};

/** Métricas ya calculadas por el motor existente (analytics.ts/workload.ts) agregadas por grupo — mismos campos que ReportMemberKpi a nivel de grupo, no un cálculo nuevo. */
export type TeamComparisonMetrics = {
  groupId: string;
  avgCompletedPct: number;
  avgCargaPct: number;
  avgEquilibrioScore: number | null;
  memberCount: number;
};

export type TeamComparisonResult = {
  dimension: ComparisonDimension;
  groups: TeamComparisonMetrics[];
};

/**
 * Placeholder intencional — no implementado en este sprint (Bloque 12 pide
 * explícitamente "no mostrar todavía esta funcionalidad, únicamente dejar
 * preparada la arquitectura"). Cuando se implemente, debe reutilizar los
 * KPIs ya calculados por reportInsights.ts/analytics.ts por persona y solo
 * agruparlos — nunca recalcular una fórmula nueva.
 */
export function computeTeamComparison(_groups: TeamComparisonGroup[]): TeamComparisonResult {
  throw new Error("computeTeamComparison: no implementado — Bloque 12 es solo preparación de arquitectura (Sprint Analytics 2.1)");
}
