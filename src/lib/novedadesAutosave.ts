// Guardado automático de Control Operativo de Novedades (Días laborados y
// Horas extras). Piezas puras y compartidas por las dos pantallas: estado de
// sincronización, política de reintentos y respaldo local de lo pendiente.
//
// Principio: el personal operativo no debe acordarse de guardar. Cada edición
// válida se envía sola; lo que el servidor todavía no confirmó se conserva en
// este equipo (localStorage) y se reintenta. El respaldo local NUNCA sustituye
// a la base de datos: solo guarda cambios pendientes y se borra al confirmarse.

/** Estado visible de la sincronización (indicador discreto en pantalla). */
export type SyncState = "idle" | "saving" | "saved" | "pending" | "error";

export const SYNC_LABEL: Record<SyncState, string> = {
  idle: "",
  saving: "Guardando…",
  saved: "Guardado",
  pending: "Pendiente de sincronización",
  error: "Error al guardar",
};

/** Espera tras escribir antes de enviar (evita una petición por tecla). */
export const AUTOSAVE_DEBOUNCE_MS = 1200;

/** Reintentos ante fallos de conexión o del servidor: escalonados y con tope,
 * nunca un ciclo infinito ni una ráfaga. */
export const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];

export function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)];
}

/** Solo se reintenta lo que puede resolverse solo (red caída, servidor
 * reiniciándose o saturado). Un rechazo de reglas —fecha futura, plazo
 * vencido, período cerrado, permisos, datos inválidos, conflicto— no se
 * reintenta: necesita una corrección de la persona. */
export function isRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Reglas de plazo que informa el servidor (`me.deadlineRules`). */
export type DeadlineRules = {
  today: string;
  canBypassDeadline: boolean;
  /** `canBypass`: plazo vencido editable para ESTE tipo (rol, o el permiso
   * "Editar celdas de Días laborados" solo en Días laborados). */
  workedDays: { hours: number; earliestOpenDate: string; canBypass?: boolean };
  overtime: { hours: number; earliestOpenDate: string; canBypass?: boolean };
};

/** Error de plazo para una fecha (aaaa-mm-dd), con la misma regla que el
 * servidor ya resolvió: la pantalla no recalcula vencimientos. */
export function deadlineError(
  date: string,
  rules: DeadlineRules | undefined,
  kind: "workedDays" | "overtime",
): string | null {
  if (!rules || !date) return null;
  if (date > rules.today) return "Fecha futura: no se registran novedades por adelantado.";
  const canBypass = rules[kind].canBypass ?? rules.canBypassDeadline;
  if (!canBypass && date < rules[kind].earliestOpenDate) {
    return "El plazo de esta fecha venció: solicite la corrección al Asistente de Operaciones o al Administrador.";
  }
  return null;
}

/** Permisos por tipo de día del Supervisor en Horas extras (`me.overtimeDayRules`). */
export type OvertimeDayKind = "weekday" | "saturday" | "sunday" | "holiday";
export type OvertimeDayRules = {
  restricted: boolean;
  allowed: Record<OvertimeDayKind, boolean> | null;
  /** Nacionales (`regional` vacía) y locales (regional normalizada en minúsculas). */
  holidays: { date: string; regional: string }[];
};

const DAY_LABEL: Record<OvertimeDayKind, string> = {
  weekday: "días laborables",
  saturday: "sábados",
  sunday: "domingos",
  holiday: "feriados",
};

const regionalKey = (value: string | null | undefined) => (value ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/**
 * Réplica de `OvertimeDayPermissionService` (Django) para avisar antes de
 * guardar; el servidor revalida siempre. Un feriado en sábado o domingo exige
 * ambos permisos; un feriado entre semana, solo el de feriado.
 */
export function overtimeDayError(
  date: string,
  regional: string | null | undefined,
  rules: OvertimeDayRules | undefined,
): string | null {
  if (!rules?.restricted || !rules.allowed || !date) return null;
  const key = regionalKey(regional);
  const holiday = rules.holidays.some((h) => h.date === date && (h.regional === "" || h.regional === key));
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const kinds: OvertimeDayKind[] = [];
  if (weekday === 6) kinds.push("saturday");
  else if (weekday === 0) kinds.push("sunday");
  else if (!holiday) kinds.push("weekday");
  if (holiday) kinds.push("holiday");
  const missing = kinds.filter((k) => !rules.allowed![k]);
  if (!missing.length) return null;
  const [y, m, d] = date.split("-");
  return `No cuenta con permiso para registrar horas extras en ${missing.map((k) => DAY_LABEL[k]).join(" ni ")} (${d}/${m}/${y}). Solicítelo al Administrador.`;
}

/**
 * Columnas de horas que el Supervisor puede capturar (2026-10-20, decisión del
 * usuario): # HORAS EXTRAS corresponde a días laborables y # HORAS SABADO a
 * sábados, domingos y feriados. Sin restricción (Asistente, Administrador),
 * ambas. Ocultarlas en la captura no las quita del modelo, del consolidado
 * nacional ni de las exportaciones.
 */
export function hourColumnAccess(rules: OvertimeDayRules | undefined): { overtimeHours: boolean; saturdayHours: boolean } {
  if (!rules?.restricted || !rules.allowed) return { overtimeHours: true, saturdayHours: true };
  const a = rules.allowed;
  return { overtimeHours: a.weekday, saturdayHours: a.saturday || a.sunday || a.holiday };
}

export const HOUR_COLUMN_DENIED: Record<"overtimeHours" | "saturdayHours", string> = {
  overtimeHours: "Columna # HORAS EXTRAS no autorizada: su usuario no registra horas extras en días laborables.",
  saturdayHours: "Columna # HORAS SABADO no autorizada: su usuario no registra horas en sábados, domingos ni feriados.",
};

const STORE_PREFIX = "nexo:novedades:pendiente:";
const STORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Respaldo local de cambios pendientes, por pantalla/período/equipo/usuario.
 * Todo acceso va en try/catch: en modo privado o con el almacenamiento
 * bloqueado la pantalla sigue funcionando (solo sin respaldo). */
export function pendingStore<T>(scope: string) {
  const key = STORE_PREFIX + scope;
  return {
    load(): T | null {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { savedAt: number; value: T };
        if (!parsed || Date.now() - parsed.savedAt > STORE_TTL_MS) {
          window.localStorage.removeItem(key);
          return null;
        }
        return parsed.value;
      } catch {
        return null;
      }
    },
    save(value: T): void {
      try {
        window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
      } catch {
        // Sin espacio o almacenamiento bloqueado: se sigue sin respaldo local.
      }
    },
    clear(): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // idem
      }
    },
  };
}
