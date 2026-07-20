import "server-only";
import type { PriorityCompliance } from "@/components/kpis/types";

const PRIORITY_ORDER: PriorityCompliance["priority"][] = ["ALTA", "MEDIA", "BAJA"];

type TaskForCompliance = {
  priority: string;
  status: string;
  completedAt: Date | null;
  endDate: Date;
};

/**
 * Definición canónica de "cumplida" para TODO cálculo de cumplimiento
 * (general y por prioridad): COMPLETADA y cerrada dentro de plazo (completedAt
 * <= endDate). Usar esta misma función en ambos cálculos es lo que garantiza
 * que el cumplimiento general y el desglose por prioridad sean coherentes
 * entre sí (ver Analytics § Sprint 1 — cumplimiento por prioridad inconsistente).
 */
export function isCompletedOnTime(t: { status: string; completedAt: Date | null | undefined; endDate: Date }): boolean {
  return t.status === "COMPLETADA" && t.completedAt != null && t.completedAt.getTime() <= t.endDate.getTime();
}

/**
 * Cumplimiento por prioridad: de las tareas del período con esa prioridad, qué
 * porcentaje se completó A TIEMPO — no solo completadas, para que una tarea
 * cerrada tarde no cuente como cumplida.
 * Prioridades sin tareas en el período se incluyen igual (total: 0, pct: 0) —
 * el componente que consume esto decide cómo mostrar el caso sin datos.
 */
export function computePriorityCompliance(tasks: TaskForCompliance[]): PriorityCompliance[] {
  return PRIORITY_ORDER.map((priority) => {
    const forPriority = tasks.filter((t) => t.priority === priority);
    const completedOnTime = forPriority.filter(isCompletedOnTime).length;
    const total = forPriority.length;
    return {
      priority,
      total,
      completedOnTime,
      pct: total > 0 ? Math.round((completedOnTime / total) * 100) : 0,
    };
  });
}
