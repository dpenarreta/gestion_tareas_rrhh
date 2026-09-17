"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X, type LucideIcon } from "lucide-react";

export type ToastVariant = "success" | "error" | "info" | "warning";
export type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: string; variant: ToastVariant; message: string; action?: ToastAction };

type ToastContextValue = {
  // `action` (Sprint C §7) es opcional y deliberadamente acotado: solo tiene
  // sentido cuando repetir la MISMA llamada es una recuperación segura (ej.
  // reintentar un POST que falló) — no se agrega a todos los toasts.
  showToast: (message: string, variant?: ToastVariant, action?: ToastAction) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Mensajes estandarizados (Sprint B §11) — evitar variantes redundantes del
// mismo evento ("Guardado", "Guardado con éxito", "Se guardó correctamente"…).
export const TOAST_MESSAGES = {
  saved: "Guardado correctamente.",
  updated: "Actualizado correctamente.",
  deleted: "Eliminado correctamente.",
  saveError: "Error al guardar.",
  deleteError: "Error al eliminar.",
} as const;

// Icono + acento de color por tono, sobre superficie neutra (no relleno
// sólido) — misma convención de contraste que Badge (fondo suave, texto/ícono
// con el color del tono) para garantizar contraste AA en ambos temas.
const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const VARIANT_ACCENT: Record<ToastVariant, string> = {
  success: "border-l-success text-success",
  error: "border-l-danger text-danger",
  info: "border-l-primary text-primary",
  warning: "border-l-warning text-warning",
};

let contadorToast = 0;

/**
 * Id para la lista de toasts, sin `crypto.randomUUID`.
 *
 * Esa API **solo existe en contextos seguros** (https o localhost), y Nexo se
 * despliega por http en la red interna —decisión explícita, ver
 * `src/lib/httpsPolicy.ts`—, así que en producción era `undefined` y llamarla
 * lanzaba un TypeError *dentro de `showToast`*. El daño no era el toast
 * ausente sino lo que quedaba sin ejecutar detrás: quien llama hace
 * `showToast(...)` y **después** cierra el modal y refresca la lista, y esa
 * parte nunca llegaba a correr. Crear una tarea respondía 201, el formulario
 * seguía abierto y la lista vacía, así que la gente volvía a pulsar y creaba
 * duplicados (ver docs/AUDIT_LOG.md § 2026-09-17).
 *
 * Mismo problema que `navigator.clipboard` en `src/lib/clipboard.ts`, y la
 * segunda vez que una API de contexto seguro rompe algo en este despliegue.
 *
 * El id solo sirve como `key` de React y para descartar el toast, así que un
 * contador con marca de tiempo alcanza y no depende de ninguna API del
 * navegador.
 */
function nuevoToastId(): string {
  contadorToast += 1;
  return `toast-${Date.now()}-${contadorToast}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success", action?: ToastAction) => {
      const id = nuevoToastId();
      setToasts((prev) => [...prev, { id, variant, message, action }]);
      // Con acción (ej. "Reintentar") se deja más tiempo para que el usuario
      // pueda leerla y decidir antes de que desaparezca.
      setTimeout(() => dismiss(id), action ? 7000 : 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => {
          const Icon = VARIANT_ICON[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={`flex items-start gap-2.5 rounded-xl border border-border border-l-4 bg-surface px-4 py-3 shadow-2xl animate-pop ${VARIANT_ACCENT[t.variant]}`}
            >
              <Icon className="w-4.5 h-4.5 shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-sm font-medium text-title flex-1">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="shrink-0 text-sm font-semibold text-primary hover:text-primary-hover"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Cerrar notificación"
                className="shrink-0 text-disabled hover:text-main"
              >
                <X className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
