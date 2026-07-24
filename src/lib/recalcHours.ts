import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Suma `duration` (minutos) de todas las actividades de una tarea/proyecto y
 * actualiza su `realHours`. Antes de Sprint D este mismo patrón estaba
 * copiado 4 veces (3 en Tareas, 1 en Proyectos) — ver docs/AUDIT_LOG.md §
 * Sprint D.
 */
export async function recalcTaskRealHours(taskId: string) {
  const activities = await prisma.taskActivity.findMany({
    where: { taskId },
    select: { duration: true },
  });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.task.update({
    where: { id: taskId },
    data: { realHours: Math.round((totalMins / 60) * 100) / 100 },
  });
}

export async function recalcProjectRealHours(projectId: string) {
  const activities = await prisma.projectActivity.findMany({
    where: { projectId },
    select: { duration: true },
  });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.project.update({
    where: { id: projectId },
    data: { realHours: Math.round((totalMins / 60) * 100) / 100 },
  });
}
