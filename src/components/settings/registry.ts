// Registro central de metadatos de settings — NO almacena referencias a
// componentes (esos se colocan directamente en el JSX de ConfigCenter.tsx,
// agrupados por categoría); este archivo solo describe cada setting para que
// búsqueda/favoritos/historial/restaurar-predeterminado funcionen de forma
// genérica sin tocar el interior de cada sección. Sin "server-only": lo usan
// componentes cliente (SearchBox, FavoritesSection).

import { matchesSearch } from "@/lib/textSearch";
import type { SettingsCategory } from "@/lib/settingsCategories";

// Duplicados deliberados de los defaults de systemConfig.ts: ese archivo es
// "server-only" (importa Prisma/pg) y este registro lo usa ConfigCenter.tsx,
// un componente CLIENTE — importar desde systemConfig.ts aquí (aunque sea
// solo por una constante) bundlea el driver de Postgres en el navegador y
// rompe `next build` (ver docs/AUDIT_LOG.md § 2026-07-28, Sprint O). Deben
// mantenerse iguales a sus contrapartes DEFAULT_* en systemConfig.ts.
const DEFAULT_RETENTION_MONTHLY_REPORTS = "24";
const DEFAULT_RETENTION_ARCHIVED_TASKS = "24";
const DEFAULT_RETENTION_KNOWLEDGE_DOCS = "indefinite";
const DEFAULT_RETROACTIVE_WINDOW_DAYS = 2;
const DEFAULT_WORKDAY_END_HOUR = 17;
const DEFAULT_DESK_ARCHIVE_RETENTION_DAYS = 15;
const DEFAULT_DESK_NOTE_MAX_REPLIES = 2;
const DEFAULT_SNOOZE_PRESETS_MINUTES = [15, 30, 60, 1440];
const DEFAULT_NOVA_CACHE_TTL_MINUTES = 240;
const DEFAULT_PASSWORD_MIN_LENGTH = 6;
const DEFAULT_SESSION_DURATION_DEFAULT_HOURS = 168;
const DEFAULT_SESSION_DURATION_REMEMBER_HOURS = 720;
const DEFAULT_RETENTION_LOGIN_ATTEMPTS = "30";

export type SettingDescriptor = {
  /** Id único, kebab-case — usado como ancla de scroll (#id), clave de favorito y referencia de historial/restaurar. */
  id: string;
  label: string;
  description: string;
  /** Términos adicionales de búsqueda no visibles en label/description. */
  keywords?: string[];
  category: SettingsCategory;
  /**
   * Claves de SystemConfigHistory que esta sección administra — vacío si la
   * sección no está respaldada por SystemConfigHistory (ej. tablas CRUD como
   * Feriados/Motivos/Permisos) o si "restaurar predeterminado" no aplica.
   */
  configKeys: string[];
  /** Valor por defecto de cada clave en configKeys, en el mismo orden — usado por "restaurar predeterminado". */
  defaults?: Record<string, string>;
  /** Afecta cálculos ya en producción (Analytics/Score/carga) — se muestra con una insignia distinta. */
  isHighImpact?: boolean;
};

export const SETTINGS_REGISTRY: SettingDescriptor[] = [
  // ── Organización ───────────────────────────────────────────────────────
  {
    id: "role-compatibility",
    label: "Compatibilidad Operativa",
    description: "Matriz de cargos adicionales con los que cada rol puede redistribuir carga, usada por el motor determinista de recomendaciones.",
    keywords: ["cargos", "roles", "redistribución", "jerarquía"],
    category: "organizacion",
    configKeys: [],
    isHighImpact: true,
  },
  {
    id: "role-targets",
    label: "Objetivos de Cargo",
    description: "Valores de referencia opcionales por cargo (Performance, Riesgo, Cumplimiento) usados solo en el Benchmark Personal.",
    keywords: ["benchmark", "meta", "objetivo"],
    category: "organizacion",
    configKeys: [],
  },

  // ── Analytics ──────────────────────────────────────────────────────────
  {
    id: "analytics-config",
    label: "Pesos y umbrales del motor",
    description: "Ponderaciones de Equilibrio Operativo, Performance Score, Índice de Riesgo Operativo, alertas y caché del Analytics Engine.",
    keywords: ["equilibrio operativo", "performance score", "riesgo operativo", "pesos", "umbrales"],
    category: "analytics",
    configKeys: [],
    isHighImpact: true,
  },
  {
    id: "normalization-curves",
    label: "Curvas de normalización",
    description: "Curvas de interpolación que convierten cada indicador crudo a un score 0-100.",
    keywords: ["curvas", "normalización", "score"],
    category: "analytics",
    configKeys: [],
    isHighImpact: true,
  },
  {
    id: "prediction-window",
    label: "Ventana histórica",
    description: "Semanas hacia atrás que usa Analytics Predictivo (Trend Engine) como muestra — 3 (predeterminado), 4, 6, 8 o 12 semanas.",
    keywords: ["ventana", "predictivo", "trend engine", "semanas"],
    category: "analytics",
    configKeys: ["prediction_window_weeks"],
    defaults: { prediction_window_weeks: "3" },
  },
  {
    id: "engine-diagnostics",
    label: "Diagnóstico del motor",
    description: "Reporte interno de caché/validaciones/calidad de datos del Analytics Engine centralizado.",
    keywords: ["diagnóstico", "motor", "versión"],
    category: "analytics",
    configKeys: [],
  },
  {
    id: "data-quality",
    label: "Calidad del dato",
    description: "Reporte de inconsistencias detectadas por el motor (fechas inválidas, horas duplicadas, registros sin propietario).",
    keywords: ["calidad", "inconsistencias", "auditoría"],
    category: "analytics",
    configKeys: [],
  },

  // ── Trabajo ────────────────────────────────────────────────────────────
  {
    id: "activity-reasons",
    label: "Motivos",
    description: "CRUD de motivos de actividades de Seguimiento, con archivo/restauración y asignación por rol.",
    keywords: ["motivos", "actividades", "seguimiento"],
    category: "trabajo",
    configKeys: [],
  },
  {
    id: "holidays",
    label: "Feriados",
    description: "Calendario de feriados nacionales excluidos del cálculo de días hábiles.",
    keywords: ["calendario", "días hábiles", "no laborables"],
    category: "trabajo",
    configKeys: [],
  },
  {
    id: "leave-records",
    label: "Permisos y licencias",
    description: "Registro de permisos médicos/personales/vacaciones por colaborador, usados en el cálculo de carga laboral.",
    keywords: ["permisos", "licencias", "vacaciones", "ausencias"],
    category: "trabajo",
    configKeys: [],
  },
  {
    id: "special-status",
    label: "Estado especial",
    description: "Períodos de maternidad/lactancia que sobreescriben la base y límites de carga laboral de una persona.",
    keywords: ["maternidad", "lactancia", "estado especial"],
    category: "trabajo",
    configKeys: [],
  },
  {
    id: "kpi-start-date",
    label: "Fecha de inicio de KPI",
    description: "Ajuste puntual por usuario del día desde el que se calculan sus KPIs del mes en curso.",
    keywords: ["kpi", "fecha inicio"],
    category: "trabajo",
    configKeys: [],
    isHighImpact: true,
  },
  {
    id: "workload-config",
    label: "Configuración de Carga Laboral",
    description: "4 límites independientes del semáforo de carga laboral (Subutilización/Moderado/Óptimo/Elevada/Sobrecarga).",
    keywords: ["carga laboral", "semáforo", "límites", "horas efectivas"],
    category: "trabajo",
    configKeys: ["HORAS_EFECTIVAS_DIA", "workload_limit_low", "workload_limit_high", "workload_limit_overload"],
    defaults: {
      HORAS_EFECTIVAS_DIA: "6.5",
      workload_limit_low: "5.5",
      workload_limit_high: "7.5",
      workload_limit_overload: "8.5",
    },
    isHighImpact: true,
  },
  {
    id: "trabajo-avanzado",
    label: "Ventana retroactiva y hora de corte",
    description: "Días hábiles para registro retroactivo de horas y hora de corte de jornada usada por Capacidad Proyectada.",
    keywords: ["retroactivo", "capacidad proyectada", "hora de corte", "jornada"],
    category: "trabajo",
    configKeys: ["retroactive_window_business_days", "capacity_workday_end_hour_local"],
    defaults: {
      retroactive_window_business_days: String(DEFAULT_RETROACTIVE_WINDOW_DAYS),
      capacity_workday_end_hour_local: String(DEFAULT_WORKDAY_END_HOUR),
    },
  },

  // ── Escritorio Digital ─────────────────────────────────────────────────
  {
    id: "escritorio-digital-config",
    label: "Retención, respuestas y posposición",
    description: "Días de retención de notas archivadas, tope de respuestas por nota y presets de posposición de recordatorios.",
    keywords: ["notas", "recordatorios", "archivado", "posposición", "snooze"],
    category: "escritorio_digital",
    configKeys: ["desk_archive_retention_days", "desk_note_max_replies", "desk_reminder_snooze_presets_minutes"],
    defaults: {
      desk_archive_retention_days: String(DEFAULT_DESK_ARCHIVE_RETENTION_DAYS),
      desk_note_max_replies: String(DEFAULT_DESK_NOTE_MAX_REPLIES),
      desk_reminder_snooze_presets_minutes: JSON.stringify(DEFAULT_SNOOZE_PRESETS_MINUTES),
    },
  },

  // ── Reportes ───────────────────────────────────────────────────────────
  // (sin secciones activas este sprint — ver ProximamenteCard en ConfigCenter.tsx)

  // ── NOVA ───────────────────────────────────────────────────────────────
  {
    id: "knowledge-base",
    label: "Base de conocimiento RRHH",
    description: "Documentos PDF indexados que NOVA usa para responder consultas de RRHH (búsqueda semántica).",
    keywords: ["nova", "documentos", "rag", "conocimiento"],
    category: "nova",
    configKeys: [],
  },
  {
    id: "nova-cache",
    label: "Caché de mensajes",
    description: "Minutos que NOVA reutiliza un mensaje generado (Dashboard + Insights de Analytics) antes de volver a llamar al modelo de IA.",
    keywords: ["nova", "caché", "ttl", "groq"],
    category: "nova",
    configKeys: ["nova_cache_ttl_minutes"],
    defaults: { nova_cache_ttl_minutes: String(DEFAULT_NOVA_CACHE_TTL_MINUTES) },
  },

  // ── Seguridad ──────────────────────────────────────────────────────────
  {
    id: "password-management",
    label: "Gestión de contraseñas",
    description: "Resetea la contraseña de cualquier usuario al valor por defecto.",
    keywords: ["contraseña", "reset", "usuarios"],
    category: "seguridad",
    configKeys: [],
  },
  {
    id: "seguridad-config",
    label: "Política de contraseña y sesión",
    description: "Longitud mínima de contraseña, duración de sesión y retención de intentos de login.",
    keywords: ["contraseña", "sesión", "login", "intentos"],
    category: "seguridad",
    configKeys: [
      "password_min_length",
      "session_duration_default_hours",
      "session_duration_remember_hours",
      "retention_login_attempts",
    ],
    defaults: {
      password_min_length: String(DEFAULT_PASSWORD_MIN_LENGTH),
      session_duration_default_hours: String(DEFAULT_SESSION_DURATION_DEFAULT_HOURS),
      session_duration_remember_hours: String(DEFAULT_SESSION_DURATION_REMEMBER_HOURS),
      retention_login_attempts: DEFAULT_RETENTION_LOGIN_ATTEMPTS,
    },
    isHighImpact: true,
  },
  {
    id: "data-consent",
    label: "Consentimiento de datos",
    description: "Estado del aviso de protección de datos (LOPDP) aceptado por cada usuario, con opción de restablecerlo.",
    keywords: ["lopdp", "consentimiento", "privacidad"],
    category: "seguridad",
    configKeys: [],
  },
  {
    id: "data-requests",
    label: "Solicitudes de titulares",
    description: "Solicitudes de acceso, rectificación y eliminación (LOPDP) enviadas por los usuarios desde su perfil.",
    keywords: ["lopdp", "solicitudes", "titulares"],
    category: "seguridad",
    configKeys: [],
  },
  {
    id: "retention-policy",
    label: "Política de retención de datos",
    description: "Meses de conservación de informes mensuales, tareas archivadas y documentos de Nova, con depuración manual.",
    keywords: ["lopdp", "purga", "eliminación", "retención"],
    category: "seguridad",
    configKeys: ["retention_monthly_reports", "retention_archived_tasks", "retention_knowledge_docs"],
    defaults: {
      retention_monthly_reports: DEFAULT_RETENTION_MONTHLY_REPORTS,
      retention_archived_tasks: DEFAULT_RETENTION_ARCHIVED_TASKS,
      retention_knowledge_docs: DEFAULT_RETENTION_KNOWLEDGE_DOCS,
    },
    isHighImpact: true,
  },

  // ── Notificaciones ─────────────────────────────────────────────────────
  {
    id: "notification-rules",
    label: "Reglas de notificación",
    description: "Roles notificados por comentarios de tareas y por registro de horas retroactivo.",
    keywords: ["notificaciones", "comentarios", "retroactivo"],
    category: "notificaciones",
    configKeys: [],
  },

  // ── Parámetros Globales ────────────────────────────────────────────────
  {
    id: "global-params",
    label: "Parámetros Globales",
    description: "Zona horaria de negocio, primer día de semana y formato de fecha — solo lectura este sprint.",
    keywords: ["zona horaria", "idioma", "fecha", "semana"],
    category: "parametros_globales",
    configKeys: [],
  },

  // ── Sistema ────────────────────────────────────────────────────────────
  {
    id: "welcome-message",
    label: "Mensaje de bienvenida",
    description: "Banner de texto mostrado a todos en el Dashboard, con activación/desactivación.",
    keywords: ["banner", "dashboard", "anuncio"],
    category: "sistema",
    configKeys: ["welcome_message", "welcome_message_active"],
    defaults: { welcome_message: "", welcome_message_active: "false" },
  },
  {
    id: "system-info",
    label: "Información del sistema",
    description: "Versión de Nexo, último despliegue y contadores generales, con limpieza de intentos de login expirados.",
    keywords: ["versión", "sistema", "despliegue"],
    category: "sistema",
    configKeys: [],
  },
  {
    id: "documentation",
    label: "Documentación técnica",
    description: "Visor de los documentos técnicos de /docs (changelog, auditoría, decisiones, roadmap, arquitectura).",
    keywords: ["documentación", "changelog", "roadmap"],
    category: "sistema",
    configKeys: [],
  },
];

/** Filtra el registro por texto (label + description + keywords), insensible a mayúsculas/acentos. Cadena vacía devuelve todo. */
export function searchSettings(query: string): SettingDescriptor[] {
  if (!query.trim()) return SETTINGS_REGISTRY;
  return SETTINGS_REGISTRY.filter((d) => {
    const haystack = [d.label, d.description, ...(d.keywords ?? [])].join(" ");
    return matchesSearch(haystack, query);
  });
}

export function getDescriptor(id: string): SettingDescriptor | undefined {
  return SETTINGS_REGISTRY.find((d) => d.id === id);
}

export function descriptorsByCategory(category: SettingsCategory): SettingDescriptor[] {
  return SETTINGS_REGISTRY.filter((d) => d.category === category);
}
