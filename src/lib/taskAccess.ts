import "server-only";
import type { Role } from "@/generated/prisma/client";
import { getVisibleRoles } from "@/lib/roles";

type SessionLike = { userId: string; role: Role };
type TaskLike = { assignedToId: string; createdById: string; assignedTo: { role: Role } };

/**
 * Responsable/creador de la tarea, o liderazgo con visibilidad sobre el rol
 * del responsable (misma jerarquía que ya aplicaba `PATCH /api/tasks/[id]`).
 * Extraído en Sprint D (Bloque 8) porque los subrecursos de tarea
 * (comentarios, actividades, comentarios de actividad) nunca reutilizaban
 * este chequeo — cualquier usuario autenticado podía leer/escribir horas y
 * comentarios de una tarea ajena. Ver docs/AUDIT_LOG.md § Sprint D.
 */
export function canAccessTask(session: SessionLike, task: TaskLike): boolean {
  return (
    task.assignedToId === session.userId ||
    task.createdById === session.userId ||
    getVisibleRoles(session.role).includes(task.assignedTo.role)
  );
}
