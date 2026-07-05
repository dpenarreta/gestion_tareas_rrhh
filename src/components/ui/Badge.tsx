import type { HTMLAttributes, ReactNode } from "react";

type Variant = "success" | "warning" | "danger" | "neutral" | "info" | "nova";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  success: "bg-success/[.13] text-success",
  warning: "bg-warning/[.15] text-warning",
  danger: "bg-danger/[.13] text-danger",
  neutral: "bg-surface2 text-secondary",
  info: "bg-primary-surface text-primary",
  nova: "bg-nova-soft text-nova",
};

export function Badge({ variant = "neutral", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
