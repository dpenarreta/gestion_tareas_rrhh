import "server-only";
import type { ProjectPhaseStatus, ProjectPriority, ProjectStatus } from "@/components/projects/types";

/**
 * Adaptador entre la forma de Proyectos de Django (Fase 5f de la
 * migración de stack, ver docs/AUDIT_LOG.md § 2026-08-14) y
 * `src/components/projects/types.ts` (sin cambios). Mismo patrón que
 * `djangoTasksAdapter.ts`. El enmascarado de email (`maskEmailUnless`)
 * NO vive acá — sigue siendo responsabilidad de cada `route.ts`, que
 * conoce la sesión real de Next.js (`canManageUsers(session.role)`),
 * no la de Django.
 */

type DjangoProjectUserRef = {
  id: number;
  username: string;
  first_name: string;
  email: string;
  roles: { id: number; name: string }[];
};

function userRefName(user: DjangoProjectUserRef): string {
  return user.first_name || user.username;
}

function userRefRole(user: DjangoProjectUserRef): string {
  return user.roles[0]?.name ?? "";
}

function toUserRefBasic(user: DjangoProjectUserRef) {
  return { id: String(user.id), name: userRefName(user) };
}

function toUserRefWithRole(user: DjangoProjectUserRef) {
  return { id: String(user.id), name: userRefName(user), role: userRefRole(user) };
}

/** Email crudo, SIN enmascarar — el `route.ts` decide si lo enmascara. */
function toUserRefWithEmail(user: DjangoProjectUserRef) {
  return { id: String(user.id), name: userRefName(user), email: user.email, role: userRefRole(user) };
}

export type DjangoProjectListItem = {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  area: string;
  tags: string[];
  start_date: string;
  target_date: string;
  target_time_hours: number;
  real_hours: number;
  completed_at: string | null;
  responsible: DjangoProjectUserRef;
  created_by: DjangoProjectUserRef;
  participant_count: number;
  phase_count: number;
  comment_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
};

export type DjangoProjectParticipant = {
  id: number;
  user: DjangoProjectUserRef;
  added_by: DjangoProjectUserRef;
  added_at: string;
};

export type DjangoProjectPhase = {
  id: number;
  name: string;
  status: ProjectPhaseStatus;
  responsible: DjangoProjectUserRef | null;
  start_date: string | null;
  target_date: string | null;
  progress: number;
  notes: string;
  target_time_hours: number | null;
  order: number;
  registered_minutes: number;
  participants: { id: number; name: string }[];
};

export type DjangoProjectDetail = DjangoProjectListItem & {
  observations: string;
  participants: DjangoProjectParticipant[];
  phases: DjangoProjectPhase[];
  last_activity: { author_name: string; created_at: string } | null;
  activity_count: number;
};

export type DjangoProjectComment = {
  id: number;
  text: string;
  author: DjangoProjectUserRef;
  created_at: string;
};

export type DjangoProjectHistoryEntry = {
  id: number;
  event: string;
  description: string;
  previous_value: unknown;
  new_value: unknown;
  actor: DjangoProjectUserRef;
  created_at: string;
};

export type DjangoProjectDocumentListItem = {
  id: number;
  category: string;
  file_name: string;
  mime_type: string | null;
  version: number;
  previous_version_id: number | null;
  activity_id: number | null;
  uploaded_by: DjangoProjectUserRef;
  created_at: string;
};

export type DjangoProjectDocumentDetail = DjangoProjectDocumentListItem & {
  file_data: string;
};

export type DjangoProjectActivity = {
  id: number;
  phase_id: number | null;
  description: string;
  comments: string | null;
  start_time: string | null;
  end_time: string | null;
  duration: number;
  is_retroactive: boolean;
  activity_date: string | null;
  author: DjangoProjectUserRef;
  created_at: string;
  documents: { id: number; file_name: string; category: string; mime_type: string | null }[];
};

function mapListFields(project: DjangoProjectListItem) {
  return {
    id: String(project.id),
    name: project.name,
    description: project.description || null,
    status: project.status,
    priority: project.priority,
    area: project.area || null,
    tags: project.tags,
    startDate: project.start_date,
    targetDate: project.target_date,
    targetTimeHours: project.target_time_hours,
    realHours: project.real_hours,
    completedAt: project.completed_at,
    responsible: toUserRefWithRole(project.responsible),
    createdBy: toUserRefBasic(project.created_by),
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

export function mapDjangoProjectListItemToNexoShape(project: DjangoProjectListItem) {
  return {
    ...mapListFields(project),
    _count: {
      participants: project.participant_count,
      phases: project.phase_count,
      comments: project.comment_count,
      documents: project.document_count,
    },
  };
}

export function mapDjangoProjectParticipantToNexoShape(participant: DjangoProjectParticipant) {
  return {
    id: String(participant.id),
    userId: String(participant.user.id),
    user: toUserRefWithEmail(participant.user),
    addedAt: participant.added_at,
    addedBy: toUserRefBasic(participant.added_by),
  };
}

export function mapDjangoProjectPhaseToNexoShape(phase: DjangoProjectPhase) {
  return {
    id: String(phase.id),
    name: phase.name,
    status: phase.status,
    responsible: phase.responsible ? toUserRefBasic(phase.responsible) : null,
    startDate: phase.start_date,
    targetDate: phase.target_date,
    progress: phase.progress,
    notes: phase.notes || null,
    targetTimeHours: phase.target_time_hours,
    order: phase.order,
    registeredMinutes: phase.registered_minutes,
    participants: phase.participants.map((p) => ({ id: String(p.id), name: p.name })),
  };
}

export function mapDjangoProjectDetailToNexoShape(project: DjangoProjectDetail) {
  return {
    ...mapListFields(project),
    // A diferencia de la lista (`responsible` sin email — mismo criterio
    // que `projectListSelect`, que nunca lo seleccionaba), el detalle SÍ
    // trae el email crudo (sin enmascarar todavía — eso lo hace el
    // `route.ts` con `maskEmailUnless`, ver comentario del adaptador).
    responsible: toUserRefWithEmail(project.responsible),
    observations: project.observations || null,
    participants: project.participants.map(mapDjangoProjectParticipantToNexoShape),
    phases: project.phases.map(mapDjangoProjectPhaseToNexoShape),
    _count: {
      comments: project.comment_count,
      documents: project.document_count,
      activities: project.activity_count,
    },
    lastActivity: project.last_activity
      ? { authorName: project.last_activity.author_name, createdAt: project.last_activity.created_at }
      : null,
  };
}

export function mapDjangoProjectCommentToNexoShape(comment: DjangoProjectComment) {
  return {
    id: String(comment.id),
    text: comment.text,
    author: toUserRefWithRole(comment.author),
    createdAt: comment.created_at,
  };
}

export function mapDjangoProjectHistoryEntryToNexoShape(entry: DjangoProjectHistoryEntry) {
  return {
    id: String(entry.id),
    event: entry.event,
    description: entry.description,
    previousValue: entry.previous_value,
    newValue: entry.new_value,
    actor: toUserRefBasic(entry.actor),
    createdAt: entry.created_at,
  };
}

export function mapDjangoProjectDocumentListItemToNexoShape(document: DjangoProjectDocumentListItem) {
  return {
    id: String(document.id),
    category: document.category,
    fileName: document.file_name,
    mimeType: document.mime_type,
    version: document.version,
    previousVersionId: document.previous_version_id != null ? String(document.previous_version_id) : null,
    activityId: document.activity_id != null ? String(document.activity_id) : null,
    uploadedBy: toUserRefBasic(document.uploaded_by),
    createdAt: document.created_at,
  };
}

/** `projectId` no viaja en `ProjectDocumentDetailSerializer` (Django ya
 * lo valida vía la URL) — el llamador lo agrega, ya lo tiene del propio
 * `ctx.params`. */
export function mapDjangoProjectDocumentDetailToNexoShape(document: DjangoProjectDocumentDetail) {
  return {
    id: String(document.id),
    fileName: document.file_name,
    mimeType: document.mime_type,
    fileData: document.file_data,
  };
}

export function mapDjangoProjectActivityToNexoShape(activity: DjangoProjectActivity) {
  return {
    id: String(activity.id),
    phaseId: activity.phase_id != null ? String(activity.phase_id) : null,
    description: activity.description,
    comments: activity.comments,
    startTime: activity.start_time,
    endTime: activity.end_time,
    duration: activity.duration,
    isRetroactive: activity.is_retroactive,
    activityDate: activity.activity_date,
    author: toUserRefBasic(activity.author),
    createdAt: activity.created_at,
    documents: activity.documents.map((d) => ({
      id: String(d.id),
      fileName: d.file_name,
      category: d.category,
      mimeType: d.mime_type,
    })),
  };
}

/**
 * Extrae el primer mensaje de error legible del contrato uniforme de
 * Django (`{"error":{"code","message","details"}}` — ver
 * `backend/apps/core/exceptions.py`). A diferencia del helper análogo
 * de Tareas (`tasks/[id]/activities/route.ts`, que solo mira
 * `non_field_errors`), Proyectos SÍ depende de mensajes específicos por
 * campo (`description`, `activity_date`, `phase`, `activity`,
 * `previous_version_id`, etc. — ver `ActivityService`/`DocumentService`
 * en `backend/apps/projects/services.py`), así que este toma el primer
 * campo con error en `details`, cualquiera sea su nombre.
 */
export async function extractDjangoProjectErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    const details = data?.error?.details;
    if (details && typeof details === "object") {
      for (const key of Object.keys(details)) {
        const first = (details as Record<string, unknown>)[key];
        if (Array.isArray(first) && typeof first[0] === "string") return first[0];
      }
    }
    if (typeof data?.error?.message === "string" && data.error.message !== "Error en la solicitud.") {
      return data.error.message;
    }
  } catch {
    // respuesta sin cuerpo JSON — se usa el mensaje por defecto
  }
  return fallback;
}

/**
 * Papelera de Proyectos — Fase 14 del backend / cutover de stack (ver
 * docs/AUDIT_LOG.md § 2026-08-21): `trash`/`restore`/`permanent` de
 * `ProjectViewSet` construyen su `Response` de error a mano
 * (`{"error": "mensaje"}`, contrato plano), NO pasan por el manejador
 * global de excepciones — por eso NO usan
 * `extractDjangoProjectErrorMessage` (que espera el contrato anidado).
 */
export type DjangoProjectTrashItem = {
  id: number;
  name: string;
  status: string;
  responsible: { id: number; name: string };
  created_by: { id: number; name: string };
  deleted_at: string;
  expires_at: string | null;
  ms_remaining: number;
  can_delete: boolean;
};

export function mapDjangoProjectTrashItemToNexoShape(item: DjangoProjectTrashItem) {
  return {
    id: String(item.id),
    name: item.name,
    status: item.status,
    responsible: { id: String(item.responsible.id), name: item.responsible.name },
    createdBy: { id: String(item.created_by.id), name: item.created_by.name },
    deletedAt: item.deleted_at,
    expiresAt: item.expires_at,
    msRemaining: item.ms_remaining,
    canDelete: item.can_delete,
  };
}
