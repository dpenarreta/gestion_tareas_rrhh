import type { IdeaImpact, IdeaStatus } from "./types";

export const IMPACT_LABELS: Record<IdeaImpact, string> = {
  ALTO: "Alto",
  MEDIO: "Medio",
  BAJO: "Bajo",
};

export const IMPACT_STYLES: Record<IdeaImpact, string> = {
  ALTO: "bg-danger/[.13] text-danger",
  MEDIO: "bg-warning/[.15] text-warning",
  BAJO: "bg-success/[.13] text-success",
};

export const STATUS_INFO: Record<
  IdeaStatus,
  { emoji: string; label: string; headerBg: string; headerText: string; border: string; dot: string }
> = {
  PROPUESTA: { emoji: "💡", label: "Propuesta", headerBg: "bg-surface2", headerText: "text-secondary", border: "border-border", dot: "bg-disabled" },
  EN_REVISION: { emoji: "🔍", label: "En revisión", headerBg: "bg-warning/[.15]", headerText: "text-warning", border: "border-border", dot: "bg-warning" },
  APROBADA: { emoji: "📋", label: "Aprobada", headerBg: "bg-primary-surface", headerText: "text-primary", border: "border-border", dot: "bg-primary" },
  EN_DESARROLLO: { emoji: "🚧", label: "En desarrollo", headerBg: "bg-blue-500/10", headerText: "text-blue-700 dark:text-blue-300", border: "border-border", dot: "bg-blue-500" },
  EN_PRUEBAS: { emoji: "🧪", label: "En pruebas", headerBg: "bg-cyan-500/10", headerText: "text-cyan-700 dark:text-cyan-300", border: "border-border", dot: "bg-cyan-500" },
  IMPLEMENTADA: { emoji: "✅", label: "Implementada", headerBg: "bg-success/[.13]", headerText: "text-success", border: "border-border", dot: "bg-success" },
  RECHAZADA: { emoji: "❌", label: "Rechazada", headerBg: "bg-danger/[.13]", headerText: "text-danger", border: "border-border", dot: "bg-danger" },
};

export const BOARD_COLUMNS: IdeaStatus[] = [
  "PROPUESTA",
  "EN_REVISION",
  "APROBADA",
  "EN_DESARROLLO",
  "EN_PRUEBAS",
  "IMPLEMENTADA",
  "RECHAZADA",
];
