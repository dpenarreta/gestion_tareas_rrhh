import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Skeleton";

type Variant = "primary" | "secondary" | "tertiary" | "ghost" | "destructive" | "success";
type Size = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:brightness-110 shadow-[0_1px_2px_rgba(81,85,229,.25)] disabled:opacity-50 disabled:hover:brightness-100",
  secondary:
    "bg-surface border border-border2 text-main hover:bg-surface2 disabled:opacity-50",
  tertiary:
    "text-primary hover:bg-primary-surface disabled:opacity-50 disabled:hover:bg-transparent",
  ghost: "text-secondary hover:text-title hover:bg-surface2 disabled:opacity-50",
  destructive:
    "bg-danger text-white hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100",
  success:
    "bg-success text-white hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-[13px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-all disabled:cursor-not-allowed ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner className={variant === "primary" || variant === "destructive" || variant === "success" ? "text-white" : "text-current"} />}
      {children}
    </button>
  );
}
