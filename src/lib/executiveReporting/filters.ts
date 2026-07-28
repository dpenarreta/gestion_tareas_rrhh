// Contrato único de filtros del Executive Reporting Engine 2.0 — los 3
// builders (mensual / rango de meses / rango personalizado) aceptan el MISMO
// shape, discriminado por `periodo.tipoReporte`, en vez de parámetros sueltos
// distintos por endpoint. `roles`/`areas`/`colaboradores` siempre NARROWAN el
// roster ya acotado por seguridad — nunca lo amplían (ver resolveRoster.ts).
import type { Role } from "@/generated/prisma/client";

export type ExecutiveReportPeriodFilter =
  | { tipoReporte: "MENSUAL"; month: number; year: number }
  | { tipoReporte: "RANGO_MESES"; from: string; to: string }
  | { tipoReporte: "RANGO_PERSONALIZADO"; from: string; to: string };

export type ExecutiveReportFilters = {
  periodo: ExecutiveReportPeriodFilter;
  /**
   * Fecha de corte (FPS Parte IV §5) — toda la información del snapshot se
   * calcula únicamente hasta este instante; lo posterior se ignora. Si se
   * omite, el builder usa el comportamiento histórico (fin de período o
   * "ahora", lo que sea anterior) — cero cambio para los llamadores actuales
   * que todavía no exponen un selector de fecha de corte en su interfaz.
   */
  fechaCorte?: Date;
  /** Roles a incluir — intersecta con el roster que la jerarquía del generador ya permite ver (`getVisibleRoles`), nunca lo amplía. */
  roles?: Role[];
  /**
   * NEXO no tiene hoy un campo de "área"/zona independiente del rol en
   * `User` (solo `Project.area`, un tag libre de proyecto, sin relación con
   * colaboradores). Mientras esa dimensión de datos no exista, "área" se
   * resuelve como alias de `roles`: cada valor aquí se interpreta como un
   * nombre de rol a incluir, exactamente igual que `roles` (ambos se
   * intersectan). Se mantiene como campo separado porque el FPS lo pide como
   * filtro propio — el día que exista un campo de área real, este filtro
   * pasa a usarlo sin cambiar la forma del contrato ni los llamadores.
   */
  areas?: string[];
  /** Subconjunto explícito de colaboradores — reemplaza el antiguo `requestedUserIds`/`userIds` ad-hoc de los 3 endpoints. */
  colaboradores?: string[];
};
