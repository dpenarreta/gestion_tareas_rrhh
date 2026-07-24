export { formatDuration } from "@/lib/utils";

export type ActivityReasonConfig = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  assignedRoles: string[];
};

/** Todos los motivos (activos e inactivos) — usado para el selector y para resolver labels históricos. */
export async function fetchActivityReasons(): Promise<ActivityReasonConfig[]> {
  try {
    const res = await fetch("/api/activity-reasons");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Motivos activos, no archivados y asignados al rol dado — los únicos elegibles para registrar una actividad nueva. */
export function selectableReasons(reasons: ActivityReasonConfig[], role?: string): ActivityReasonConfig[] {
  return reasons.filter((r) => r.isActive && !r.isArchived && (!role || r.assignedRoles.includes(role)));
}

export function reasonLabel(reasons: ActivityReasonConfig[], key: string): string {
  return reasons.find((r) => r.key === key)?.label ?? key;
}

export function reasonIsActive(reasons: ActivityReasonConfig[], key: string): boolean {
  return reasons.find((r) => r.key === key)?.isActive ?? true;
}

export function reasonIsArchived(reasons: ActivityReasonConfig[], key: string): boolean {
  return reasons.find((r) => r.key === key)?.isArchived ?? false;
}

// Paleta rotativa asignada por hash del key — así un motivo nuevo creado desde
// Ajustes recibe un color consistente sin necesitar una entrada manual.
const COLOR_PALETTE = [
  "bg-blue-50 text-blue-700 border-blue-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-teal-50 text-teal-700 border-teal-200",
  "bg-cyan-50 text-cyan-700 border-cyan-200",
  "bg-primary-surface text-primary border-primary/30",
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-lime-50 text-lime-700 border-lime-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-orange-50 text-orange-700 border-orange-200",
  "bg-green-50 text-green-700 border-green-200",
];

export function reasonColorClass(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}
