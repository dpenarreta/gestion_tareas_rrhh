import "server-only";
import type { PriorityCompliance } from "@/components/kpis/types";
import { businessCalendarDay } from "@/lib/businessTime";
import { utcCalendarDay } from "@/lib/utils";

const PRIORITY_ORDER: PriorityCompliance["priority"][] = ["ALTA", "MEDIA", "BAJA"];

type TaskForCompliance = {
  priority: string;
  status: string;
  completedAt: Date | null;
  endDate: Date;
};

/**
 * Definición canónica de "cumplida" para TODO cálculo de cumplimiento
 * (general y por prioridad): COMPLETADA y cerrada dentro de plazo. Usar esta
 * misma función en ambos cálculos es lo que garantiza que el cumplimiento
 * general y el desglose por prioridad sean coherentes entre sí (ver Analytics
 * § Sprint 1 — cumplimiento por prioridad inconsistente).
 *
 * Comparación por DÍA CALENDARIO, no por instante exacto (corregido
 * 2026-07-24 — ver docs/AUDIT_LOG.md § misma fecha). `endDate` es un campo de
 * fecha pura (UTC-medianoche por convención — `utcCalendarDay` la lee
 * directamente, sin desplazar). `completedAt` sí es un instante real
 * (`new Date()` al momento del PATCH que cierra la tarea) y por eso se lee en
 * huso de negocio (`businessCalendarDay`, UTC-5) antes de comparar — mismo
 * patrón que `isTaskOverdue` (`src/lib/utils.ts`) usa para "vencida". Antes
 * comparaba `completedAt.getTime() <= endDate.getTime()` crudo: como
 * medianoche UTC del día de vencimiento equivale a las 7pm del día ANTERIOR
 * en huso de negocio, cualquier tarea cerrada durante el horario laboral real
 * del propio día de vencimiento quedaba mal clasificada como tardía (~51% de
 * las tareas marcadas "fuera de tiempo" en la auditoría del 2026-07-24 eran
 * en realidad del mismo día calendario).
 */
export function isCompletedOnTime(t: { status: string; completedAt: Date | null | undefined; endDate: Date }): boolean {
  if (t.status !== "COMPLETADA" || t.completedAt == null) return false;
  return businessCalendarDay(t.completedAt).getTime() <= utcCalendarDay(t.endDate);
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
