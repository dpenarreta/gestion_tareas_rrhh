import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// `src/components/ui/` no tiene primitivos de formulario; estos replican el
// estilo de input que ya usan las secciones de Ajustes.
const FIELD =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="block text-xs font-semibold text-secondary mb-1">
      {children}
      {hint && <span className="font-normal text-secondary/80"> — {hint}</span>}
    </span>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} ${className}`} {...props} />;
}

export function SelectInput({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${FIELD} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} ${className}`} rows={3} {...props} />;
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-danger bg-danger/[.08] border border-danger/30 rounded-lg px-3 py-2">{message}</p>;
}
