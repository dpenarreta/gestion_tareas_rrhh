/**
 * Validación de Fecha Fin por líderes — funciones puras, sin acceso a BD
 * (mismo patrón que targetTime.ts, importable desde componentes cliente y
 * rutas de API). Gobierna Task.endDate con el mismo espíritu que Tiempo
 * Objetivo gobierna Task.estimatedHours: un estado de aprobación que nunca
 * bloquea el uso normal del campo en el resto de la app — mientras esté
 * PENDIENTE, endDate sigue siendo perfectamente válido para KPIs/overdue/
 * cierre de mes, exactamente igual que hoy.
 */

import type { Role, EndDateApprovalStatus, EndDateAuditAction } from "@/generated/prisma/client";
import { CAN_VALIDATE_TARGET_TIME_ROLES } from "@/lib/targetTime";

export type { EndDateApprovalStatus, EndDateAuditAction };

// ── Validación por líderes ───────────────────────────────────────────────────
// Reusa la MISMA lista de roles que Tiempo Objetivo (no hay un campo
// managerId/"jefe directo" explícito en User — la autorización en NEXO
// siempre fue por jerarquía de roles, ver src/lib/roles.ts). Una tarea de
// alguien sin ningún rol validador por encima (p. ej. el propio Jefe
// Nacional) simplemente nunca sale de PENDIENTE — mismo comportamiento que
// ya tiene Tiempo Objetivo para esos casos.

/** Nunca el responsable de la tarea, sin importar su rol — mismo criterio que canValidateTargetTime. */
export function canValidateEndDate(role: Role, assignedToId: string, userId: string): boolean {
  return CAN_VALIDATE_TARGET_TIME_ROLES.includes(role) && assignedToId !== userId;
}

export const END_DATE_ACTIONS = ["APROBAR", "MODIFICAR", "RECHAZAR"] as const;
export type EndDateAction = (typeof END_DATE_ACTIONS)[number];

export function isValidEndDateAction(value: unknown): value is EndDateAction {
  return typeof value === "string" && (END_DATE_ACTIONS as readonly string[]).includes(value);
}

// ── Etiquetas/indicadores visuales (spec: 🟡🟢🔵🔴) ──────────────────────────

export const END_DATE_STATUS_LABEL: Record<EndDateApprovalStatus, string> = {
  PENDIENTE: "Pendiente de validación",
  APROBADA: "Fecha aprobada",
  MODIFICADA: "Fecha modificada por el líder",
  RECHAZADA: "Fecha rechazada",
};

export const END_DATE_STATUS_EMOJI: Record<EndDateApprovalStatus, string> = {
  PENDIENTE: "🟡",
  APROBADA: "🟢",
  MODIFICADA: "🔵",
  RECHAZADA: "🔴",
};

/** Mismos tokens de color que el resto del design system (success/warning/primary/danger). */
export const END_DATE_STATUS_COLOR: Record<EndDateApprovalStatus, "warning" | "success" | "primary" | "danger"> = {
  PENDIENTE: "warning",
  APROBADA: "success",
  MODIFICADA: "primary",
  RECHAZADA: "danger",
};

export const END_DATE_AUDIT_ACTION_LABEL: Record<EndDateAuditAction, string> = {
  PROPUESTA: "Fecha propuesta",
  APROBADA: "Aprobada",
  MODIFICADA: "Modificada",
  RECHAZADA: "Rechazada",
};

/**
 * Tailwind necesita clases literales completas (no interpoladas) para
 * detectarlas en el build — mismo motivo por el que el resto de la app (p.
 * ej. renderReportHtml.ts § ESTADO_COLOR_CLASS) usa un Record en vez de
 * construir el nombre de clase dinámicamente. Centralizado aquí (no local a
 * un componente) porque tanto ActivityPanel.tsx como
 * RegularizeTargetTimeManager.tsx muestran el mismo badge de estado.
 */
export const END_DATE_BADGE_CLASS: Record<EndDateApprovalStatus, string> = {
  PENDIENTE: "bg-warning/[.15] text-warning",
  APROBADA: "bg-success/[.13] text-success",
  MODIFICADA: "bg-primary-surface text-primary",
  RECHAZADA: "bg-danger/[.09] text-danger",
};
