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
  workedDays: { hours: number; earliestOpenDate: string };
  overtime: { hours: number; earliestOpenDate: string };
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
  if (!rules.canBypassDeadline && date < rules[kind].earliestOpenDate) {
    return "El plazo de esta fecha venció: solicite la corrección al Asistente de Operaciones o al Administrador.";
  }
  return null;
}

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
