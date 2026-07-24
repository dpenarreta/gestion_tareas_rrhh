"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X, type LucideIcon } from "lucide-react";

export type ToastVariant = "success" | "error" | "info" | "warning";
type ToastItem = { id: string; variant: ToastVariant; message: string };

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, variant, message }]);
      setTimeout(() => dismiss(id), 4000);
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
