import type { IdeaArea, IdeaImpact, IdeaStatus } from "./types";

export const AREA_LABELS: Record<IdeaArea, string> = {
  SELECCION: "Selección",
  GESTION_HUMANA: "Gestión Humana",
  CLIMA_CULTURA: "Clima y Cultura",
  NOMINA: "Nómina",
  OPERACIONES: "Operaciones",
  OTRO: "Otro",
};

export const IMPACT_LABELS: Record<IdeaImpact, string> = {
  ALTO: "Alto",
  MEDIO: "Medio",
  BAJO: "Bajo",
};

export const IMPACT_STYLES: Record<IdeaImpact, string> = {
  ALTO: "bg-red-100 text-red-700",
  MEDIO: "bg-yellow-100 text-yellow-700",
  BAJO: "bg-green-100 text-green-700",
};

export const STATUS_INFO: Record<
  IdeaStatus,
  { emoji: string; label: string; headerBg: string; headerText: string; border: string; dot: string }
> = {
  PROPUESTA: { emoji: "💡", label: "Propuesta", headerBg: "bg-slate-50", headerText: "text-slate-700", border: "border-slate-200", dot: "bg-slate-400" },
  EN_REVISION: { emoji: "🔍", label: "En revisión", headerBg: "bg-amber-50", headerText: "text-amber-700", border: "border-amber-200", dot: "bg-amber-400" },
  APROBADA: { emoji: "📋", label: "Aprobada", headerBg: "bg-indigo-50", headerText: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-400" },
  EN_DESARROLLO: { emoji: "🚧", label: "En desarrollo", headerBg: "bg-blue-50", headerText: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
  EN_PRUEBAS: { emoji: "🧪", label: "En pruebas", headerBg: "bg-violet-50", headerText: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
  IMPLEMENTADA: { emoji: "✅", label: "Implementada", headerBg: "bg-green-50", headerText: "text-green-700", border: "border-green-200", dot: "bg-green-500" },
  RECHAZADA: { emoji: "❌", label: "Rechazada", headerBg: "bg-red-50", headerText: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
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
