export type TaskColor = { value: string; label: string; hex: string };

export const TASK_COLORS: TaskColor[] = [
  { value: "blue", label: "Azul", hex: "#3b82f6" },
  { value: "green", label: "Verde", hex: "#22c55e" },
  { value: "purple", label: "Morado", hex: "#8b5cf6" },
  { value: "orange", label: "Naranja", hex: "#f97316" },
  { value: "pink", label: "Rosa", hex: "#ec4899" },
  { value: "red", label: "Rojo", hex: "#ef4444" },
  { value: "yellow", label: "Amarillo", hex: "#eab308" },
  { value: "gray", label: "Gris", hex: "#6b7280" },
  { value: "turquoise", label: "Turquesa", hex: "#14b8a6" },
  { value: "black", label: "Negro", hex: "#1e293b" },
];

export function taskColorHex(value: string | null): string | null {
  if (!value) return null;
  return TASK_COLORS.find((c) => c.value === value)?.hex ?? null;
}
