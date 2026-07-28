// Bloque 11 (`reportInsights.ts`) — Índice Ejecutivo del Equipo: clasificador
// puro, extraído a su PROPIO módulo sin "server-only" ni dependencias.
//
// Causa raíz de un fallo real de build (ver docs/AUDIT_LOG.md § Fix Índice
// Ejecutivo — límite cliente/servidor): `estadoGeneral.ts` (usado por
// `documentModel.ts`, que a su vez `ReportWizardModal.tsx`/
// `MonthlyReports.tsx` — Client Components — importan directamente para
// generar el PDF/Excel en el navegador) necesita reutilizar
// `classifyIndiceEjecutivo`. Antes vivía únicamente en `reportInsights.ts`,
// que empieza con `import "server-only"` — al importarlo desde
// `estadoGeneral.ts`, TODO ese archivo (con sus dependencias reales:
// Prisma, `getHolidaySet`, `analytics.ts`, etc.) se arrastraba al bundle de
// cliente. Next.js/Turbopack detecta la violación y debería fallar con un
// error de build claro — pero un bug de Turbopack (panic de Rust al
// renderizar el code frame del diagnóstico, `crates/next-code-frame/src/
// highlight.rs`, con un byte no-ASCII de un comentario en `holidays.ts`)
// hacía que el build entero colapsara en su lugar, en producción.
//
// `classifyIndiceEjecutivo` no tiene NINGUNA dependencia de I/O — es una
// regla fija sobre 2 números ya promediados por el caller — así que no
// necesitaba vivir en un archivo `"server-only"` en primer lugar.
// `reportInsights.ts` sigue reexportándolo (ver ese archivo) para no romper
// a sus consumidores existentes (`buildSnapshotData.ts`, tests) — pero todo
// código potencialmente reutilizable desde un Client Component debe
// importarlo DESDE AQUÍ, nunca desde `reportInsights.ts`.

export type IndiceEjecutivoNivel = "Excelente" | "Bueno" | "Atención" | "Crítico";
export type IndiceEjecutivoResult = {
  valor: number;
  nivel: IndiceEjecutivoNivel;
  color: "green" | "yellow" | "red";
  explicacion: string;
};

/**
 * Promedio simple de Performance Score + Equilibrio Operativo por miembro,
 * ya promediados por el caller — esta función solo clasifica el resultado.
 * Solo tiene sentido para el mes calendario en curso (Equilibrio Operativo
 * incluye Capacidad Futura, una proyección hacia adelante desde "ahora";
 * recalcularla para un mes pasado no es representativo) — el caller decide
 * cuándo invocar esto.
 */
export function classifyIndiceEjecutivo(avgPerformance: number, avgEquilibrio: number): IndiceEjecutivoResult {
  const valor = Math.round(((avgPerformance + avgEquilibrio) / 2) * 10) / 10;
  if (valor >= 85) {
    return { valor, nivel: "Excelente", color: "green", explicacion: "El equipo mantiene un desempeño y equilibrio operativo sobresalientes. Puede asumir nuevos proyectos sin riesgo." };
  }
  if (valor >= 70) {
    return { valor, nivel: "Bueno", color: "green", explicacion: "El equipo opera de forma saludable, con desempeño y equilibrio dentro de rangos aceptables." };
  }
  if (valor >= 50) {
    return { valor, nivel: "Atención", color: "yellow", explicacion: "El equipo muestra señales que conviene atender antes de que se conviertan en un problema operativo mayor." };
  }
  return { valor, nivel: "Crítico", color: "red", explicacion: "El equipo requiere intervención inmediata — el desempeño y/o el equilibrio operativo están comprometidos." };
}
