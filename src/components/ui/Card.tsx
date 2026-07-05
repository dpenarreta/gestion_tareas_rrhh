import type { ReactNode, HTMLAttributes, HTMLAttributes as HeadingAttrs } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-[14px] shadow-[var(--shadow)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

type CardHeaderProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function CardHeader({ className = "", children, ...props }: CardHeaderProps) {
  return (
    <div className={`px-5 py-4 border-b border-border ${className}`} {...props}>
      {children}
    </div>
  );
}

type CardTitleProps = HeadingAttrs<HTMLHeadingElement> & { children: ReactNode };

export function CardTitle({ className = "", children, ...props }: CardTitleProps) {
  return (
    <h2
      className={`text-[13px] font-semibold text-secondary uppercase tracking-wider ${className}`}
      {...props}
    >
      {children}
    </h2>
  );
}

type CardBodyProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function CardBody({ className = "", children, ...props }: CardBodyProps) {
  return (
    <div className={`px-5 py-4 ${className}`} {...props}>
      {children}
    </div>
  );
}
