import "server-only";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LEVEL } from "@/lib/roles";

type SessionLike = { userId: string; role: Role };
type ProjectLike = { responsibleId: string; createdById: string };

/**
 * Liderazgo (Coordinador Nacional/Jefe Nacional/Administrador, nivel >= 3) o
 * el responsable/creador del proyecto — igual criterio que valida cambios de
 * estado (§3), fases y participantes (§5). Nivel >= 3 en vez de canManageUsers
 * porque Coordinador ZS/Analistas (nivel 2) participan de proyectos pero no
 * dirigen la iniciativa salvo que sean el responsable designado.
 */
export function isProjectManager(session: SessionLike, project: ProjectLike): boolean {
  if (ROLE_LEVEL[session.role] >= 3) return true;
  return session.userId === project.responsibleId || session.userId === project.createdById;
}

export function canChangeProjectStatus(session: SessionLike, project: ProjectLike): boolean {
  return isProjectManager(session, project);
}

export function canManageParticipants(session: SessionLike, project: ProjectLike): boolean {
  return isProjectManager(session, project);
}

export function canManagePhases(session: SessionLike, project: ProjectLike): boolean {
  return isProjectManager(session, project);
}

/**
 * Sprint 2.1 §3: eliminación (papelera/restaurar/eliminar definitivamente)
 * queda reservada ÚNICAMENTE al creador del proyecto — a propósito más
 * estricta que isProjectManager (que también habilita a liderazgo y al
 * responsable). Responsable y creador son conceptos distintos desde este
 * sprint (§2); solo el creador puede destruir/recuperar el proyecto.
 */
export function isProjectCreator(session: SessionLike, project: Pick<ProjectLike, "createdById">): boolean {
  return session.userId === project.createdById;
}

/** Liderazgo ve todos los proyectos; el resto solo los propios (responsable/creador/participante). */
export function canViewProject(
  session: SessionLike,
  project: ProjectLike,
  participantUserIds: string[]
): boolean {
  if (ROLE_LEVEL[session.role] >= 3) return true;
  if (session.userId === project.responsibleId || session.userId === project.createdById) return true;
  return participantUserIds.includes(session.userId);
}

/** Puede comentar/registrar actividad/subir documentos: participante o manager del proyecto (§5, §7). */
export function isProjectParticipant(
  session: SessionLike,
  project: ProjectLike,
  participantUserIds: string[]
): boolean {
  if (isProjectManager(session, project)) return true;
  return participantUserIds.includes(session.userId);
}
