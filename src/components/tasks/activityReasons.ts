import type { ActivityReason } from "./types";

// Etiquetas de TODOS los motivos, incluidos los retirados del selector — se
// necesitan para mostrar correctamente actividades históricas que ya
// registraron un motivo que hoy no es seleccionable para actividades nuevas.
export const REASON_LABELS: Record<ActivityReason, string> = {
  NOVEDADES_PAGO: "Novedades de Pago",
  RETENCION_PAGO: "Retención de Pago",
  FACTURAS: "Facturas",
  CONSULTA_OPERACIONES: "Consulta de Operaciones",
  SOLICITUD_VACACIONES: "Solicitud de Vacaciones",
  SOLICITUD_PERMISO: "Solicitud de Permiso",
  VISITA_DOMICILIARIA: "Visita Domiciliaria",
  SEGUIMIENTO_AUSENTISMOS: "Seguimiento de Ausentismos",
  RECLUTAMIENTO_SELECCION: "Reclutamiento y Selección",
  SEGUIMIENTO_DOCUMENTACION: "Seguimiento de documentación",
  SOLICITUDES_INTERNAS: "Solicitudes internas",
};

// Motivos disponibles para registrar actividades nuevas.
export const SELECTABLE_REASONS: ActivityReason[] = [
  "NOVEDADES_PAGO",
  "FACTURAS",
  "CONSULTA_OPERACIONES",
  "VISITA_DOMICILIARIA",
  "SEGUIMIENTO_AUSENTISMOS",
  "RECLUTAMIENTO_SELECCION",
  "SEGUIMIENTO_DOCUMENTACION",
  "SOLICITUDES_INTERNAS",
];

export const REASON_OPTIONS: { value: ActivityReason; label: string }[] = SELECTABLE_REASONS.map((value) => ({
  value,
  label: REASON_LABELS[value],
}));

export const REASON_COLORS: Record<ActivityReason, string> = {
  NOVEDADES_PAGO: "bg-blue-50 text-blue-700 border-blue-200",
  RETENCION_PAGO: "bg-orange-50 text-orange-700 border-orange-200",
  FACTURAS: "bg-amber-50 text-amber-700 border-amber-200",
  CONSULTA_OPERACIONES: "bg-violet-50 text-violet-700 border-violet-200",
  SOLICITUD_VACACIONES: "bg-green-50 text-green-700 border-green-200",
  SOLICITUD_PERMISO: "bg-rose-50 text-rose-700 border-rose-200",
  VISITA_DOMICILIARIA: "bg-teal-50 text-teal-700 border-teal-200",
  SEGUIMIENTO_AUSENTISMOS: "bg-cyan-50 text-cyan-700 border-cyan-200",
  RECLUTAMIENTO_SELECCION: "bg-primary-surface text-primary border-primary/30",
  SEGUIMIENTO_DOCUMENTACION: "bg-indigo-50 text-indigo-700 border-indigo-200",
  SOLICITUDES_INTERNAS: "bg-lime-50 text-lime-700 border-lime-200",
};

/** "6.30" → "6h 30min" (para mostrar duraciones en minutos como texto legible). */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}min`;
}
