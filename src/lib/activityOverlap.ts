import "server-only";
import { prisma } from "@/lib/prisma";
import { businessDayRealRange } from "@/lib/businessTime";
import { rangesOverlap } from "@/lib/timeOverlap";

export type OverlapConflict = {
  startTime: string;
  endTime: string;
  taskTitle: string;
};

/**
 * Busca, entre TODAS las actividades del usuario ese día (cualquier tarea
 * SEGUIMIENTO, sin importar cuál — las tareas FIJA no participan), una cuyo
 * horario [startTime,endTime) se solape con el nuevo. `day` es un Date
 * UTC-medianoche (día calendario de negocio, ver businessCalendarDay).
 */
export async function findOverlappingActivity(
  userId: string,
  day: Date,
  startTime: string,
  endTime: string
): Promise<OverlapConflict | null> {
  const { start, end } = businessDayRealRange(day);
  const candidates = await prisma.taskActivity.findMany({
    where: {
      authorId: userId,
      createdAt: { gte: start, lte: end },
      startTime: { not: null },
      endTime: { not: null },
      task: { type: "SEGUIMIENTO" },
    },
    select: { startTime: true, endTime: true, task: { select: { title: true } } },
  });

  for (const c of candidates) {
    if (!c.startTime || !c.endTime) continue;
    if (rangesOverlap(startTime, endTime, c.startTime, c.endTime)) {
      return { startTime: c.startTime, endTime: c.endTime, taskTitle: c.task.title };
    }
  }
  return null;
}

export function overlapMessage(conflict: OverlapConflict): string {
  return `Este horario se superpone con una actividad registrada de ${conflict.startTime} a ${conflict.endTime} en la tarea "${conflict.taskTitle}". Por favor ajusta el horario.`;
}
