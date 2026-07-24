import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon = Inbox, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
      <div className="w-12 h-12 rounded-full bg-surface2 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-disabled" strokeWidth={1.6} />
      </div>
      <p className="text-sm font-semibold text-title mb-1">{title}</p>
      {description && <p className="text-[13px] text-secondary max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}
