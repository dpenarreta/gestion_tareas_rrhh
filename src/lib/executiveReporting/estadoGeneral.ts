// Executive Reporting Engine 2.0 — constructor ÚNICO del "Estado General"
// (Portada + `ExecutiveReportContext` para NOVA). Corrige una inconsistencia
// real (ver docs/AUDIT_LOG.md § 2026-07-28 — Fix Estado General): la Portada
// mostraba "Sin datos para el período" en TODO `RANGO_MESES`/
// `RANGO_PERSONALIZADO`, y en cualquier `MENSUAL` que no fuera el mes
// calendario en curso, aun cuando el snapshot traía colaboradores,
// indicadores, hallazgos y recomendaciones completos — porque la Portada
// leía `estadoGeneral.indiceEjecutivo` directo y ese campo es (por diseño,
// ver `IndiceEjecutivoData`) exclusivo del mes en curso: incorpora Equilibrio
// Operativo, que a su vez incluye Capacidad Futura, una proyección hacia
// adelante que no es representativa de un período ya cerrado o de un rango.
//
// La causa raíz NO estaba en los 3 builders de `buildSnapshotData.ts` — los
// tres construyen `estadoGeneral: { indiceEjecutivo, dataQuality }` con la
// misma forma, y `dataQuality` ya se calculaba idéntico en los tres vía
// `computeDataQuality` (FPS Parte IV §11). Estaba en que dos consumidores de
// presentación (`documentModel.ts::buildCoverPage`, `context.ts::
// deriveExecutiveReportContext`) trataban "indiceEjecutivo ausente" como
// sinónimo de "sin datos", cuando en realidad solo significa "el sub-índice
// más granular no aplica a este período" — un caso completamente distinto de
// "el snapshot está vacío".
//
// Este módulo separa ambos conceptos con UN solo procedimiento, reutilizado
// por todo tipo de reporte (mensual/rango/rango personalizado, consolidado/
// por área/individual) sin ninguna rama específica por tipo:
//   1. Snapshot realmente vacío (sin colaboradores ni actividad) → "Sin datos
//      para el período" — el único caso legítimo para ese mensaje.
//   2. `indiceEjecutivo` presente (mes calendario en curso) → se usa tal
//      cual, sin recalcular nada.
//   3. Snapshot con datos pero sin `indiceEjecutivo` (rango, rango
//      personalizado, o mes ya cerrado) → aproximación de respaldo,
//      calculada EXCLUSIVAMENTE con números que el snapshot ya trae en
//      `teamSummary` (cero Prisma, cero Analytics nuevo): reutiliza el mismo
//      clasificador de bandas de `classifyIndiceEjecutivo` (Bloque 11,
//      `executiveReporting/indiceEjecutivo.ts`) aplicado a Cumplimiento +
//      proximidad de Carga Laboral al 100% ideal, en vez de Performance +
//      Equilibrio. Mismas etiquetas (Excelente/Bueno/Atención/Crítico) y
//      mismos umbrales (85/70/50) que el Índice Ejecutivo completo — nunca
//      una escala paralela — pero la `explicacion` deja explícito que es
//      una aproximación, no el Índice Ejecutivo completo.
//
// `classifyIndiceEjecutivo` se importa de `./indiceEjecutivo` (NUNCA de
// `@/lib/reportInsights`, que empieza con `import "server-only"`) — este
// módulo lo usa `documentModel.ts`, que a su vez importan Client Components
// (`ReportWizardModal.tsx`/`MonthlyReports.tsx`) para generar el PDF/Excel
// en el navegador. Importar del archivo "server-only" arrastraría Prisma/
// `getHolidaySet`/etc. al bundle de cliente: Next.js lo rechaza en build
// (correcto), pero un bug de Turbopack panicaba en vez de mostrar el error
// con claridad — causa raíz real de un fallo de build en producción, ver
// docs/AUDIT_LOG.md § Fix Índice Ejecutivo — límite cliente/servidor.
import { classifyIndiceEjecutivo, type IndiceEjecutivoNivel } from "./indiceEjecutivo";
import type { ExecutiveReportSnapshotData } from "./snapshotData";

export type EstadoGeneralResolved = {
  nivel: IndiceEjecutivoNivel | "Sin datos para el período";
  color: "green" | "yellow" | "red" | "gray";
  /** `null` únicamente cuando `nivel` es "Sin datos para el período". */
  valor: number | null;
  /** `null` únicamente cuando `nivel` es "Sin datos para el período". */
  explicacion: string | null;
  /** true si `nivel`/`valor` provienen del Índice Ejecutivo completo (Performance + Equilibrio, solo mes en curso); false en la aproximación de respaldo o en "sin datos". */
  fromIndiceEjecutivo: boolean;
};

/**
 * Único criterio de "snapshot vacío" — ningún tipo de reporte tiene una
 * variante propia de esta regla. Un roster sin colaboradores, o con
 * colaboradores pero sin ninguna tarea/consulta en el período, es la única
 * situación en la que no existe absolutamente nada que resumir.
 */
function isSnapshotEmpty(snap: ExecutiveReportSnapshotData): boolean {
  const members = snap.members ?? [];
  const teamSummary = snap.teamSummary;
  return members.length === 0 && (teamSummary?.totalTasks ?? 0) === 0 && (teamSummary?.totalConsultas ?? 0) === 0;
}

/**
 * Defensiva por el mismo motivo que `buildCoverPage`/`buildStrategicIndicatorsPage`
 * (ver v1.23.2 — snapshots `LEGACY_MIGRATION` pueden llegar incompletos):
 * un snapshot con `teamSummary`/`estadoGeneral` ausentes se trata como vacío
 * en vez de lanzar `Cannot read properties of undefined`.
 */
export function resolveEstadoGeneral(snap: ExecutiveReportSnapshotData): EstadoGeneralResolved {
  if (isSnapshotEmpty(snap) || !snap.teamSummary) {
    return { nivel: "Sin datos para el período", color: "gray", valor: null, explicacion: null, fromIndiceEjecutivo: false };
  }

  const indice = snap.estadoGeneral?.indiceEjecutivo ?? null;
  if (indice) {
    return { nivel: indice.nivel, color: indice.color, valor: indice.valor, explicacion: indice.explicacion, fromIndiceEjecutivo: true };
  }

  // Aproximación de respaldo — mismas bandas/etiquetas que el Índice
  // Ejecutivo completo, aplicadas a Cumplimiento + proximidad de Carga al
  // 100% ideal (ambos ya calculados en `teamSummary`, ningún cómputo nuevo
  // de Analytics). `cargaScore` penaliza tanto sobrecarga como
  // subutilización por igual: 100% de carga puntúa 100, y cada punto de
  // desvío (en cualquier dirección) resta un punto.
  const cargaScore = Math.max(0, 100 - Math.abs(snap.teamSummary.avgCargaPct - 100));
  const classified = classifyIndiceEjecutivo(snap.teamSummary.avgCumplimiento, cargaScore);
  return {
    nivel: classified.nivel,
    color: classified.color,
    valor: classified.valor,
    explicacion: `${classified.explicacion} (aproximación basada en Cumplimiento y Carga Laboral del equipo — el Índice Ejecutivo completo, que incorpora Equilibrio Operativo y Capacidad Futura, solo aplica al mes calendario en curso).`,
    fromIndiceEjecutivo: false,
  };
}
