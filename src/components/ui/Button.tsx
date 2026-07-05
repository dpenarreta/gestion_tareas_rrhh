import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:brightness-110 shadow-[0_1px_2px_rgba(81,85,229,.25)] disabled:opacity-50 disabled:hover:brightness-100",
  secondary:
    "bg-surface border border-border2 text-main hover:bg-surface2 disabled:opacity-50",
  ghost: "text-secondary hover:text-title hover:bg-surface2 disabled:opacity-50",
  destructive:
    "bg-danger text-white hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100",
};

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
