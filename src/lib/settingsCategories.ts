// Categorías del Centro de Configuración NEXO — puro (sin "server-only"), lo
// importan tanto componentes cliente (registry.ts, CategoryNav.tsx) como el
// registro de settings. Una sección puede pertenecer a una sola categoría.

export type SettingsCategory =
  | "organizacion"
  | "analytics"
  | "trabajo"
  | "proyectos"
  | "escritorio_digital"
  | "reportes"
  | "nova"
  | "seguridad"
  | "notificaciones"
  | "parametros_globales"
  | "sistema";

export const SETTINGS_CATEGORY_LABEL: Record<SettingsCategory, string> = {
  organizacion: "Organización",
  analytics: "Analytics",
  trabajo: "Trabajo",
  proyectos: "Proyectos",
  escritorio_digital: "Escritorio Digital",
  reportes: "Reportes",
  nova: "NOVA",
  seguridad: "Seguridad",
  notificaciones: "Notificaciones",
  parametros_globales: "Parámetros Globales",
  sistema: "Sistema",
};

/** Orden de presentación en la barra de categorías. */
export const SETTINGS_CATEGORY_ORDER: SettingsCategory[] = [
  "organizacion",
  "analytics",
  "trabajo",
  "proyectos",
  "escritorio_digital",
  "reportes",
  "nova",
  "seguridad",
  "notificaciones",
  "parametros_globales",
  "sistema",
];
