import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import type { TaskFrequency, TaskPriority, TaskStatus, TaskType } from "@/components/tasks/types";

/**
 * Adaptador entre la forma de tarea de Django (Fase 3a de la migración de
 * stack, ver docs/AUDIT_LOG.md § 2026-08-07) y `src/components/tasks/types.ts`
 * (sin cambios). Mismo patrón que `djangoUsersAdapter.ts` de la Fase 2.
 */

type DjangoTaskUserRef = {
  id: number;
  username: string;
  first_name: string;
  email: string;
  roles: { id: number; name: string }[];
};

export type DjangoTask = {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  frequency: TaskFrequency;
  start_date: string;
  end_date: string;
  estimated_hours: number;
  real_hours: number;
  target_time_validated: number | null;
  progress: number;
  color: string;
  corrected: boolean;
  archived_month: string | null;
  assigned_to: DjangoTaskUserRef;
  created_by: DjangoTaskUserRef;
  comment_count: number;
  has_unread_comments: boolean;
  created_at: string;
  updated_at: string;
};

export type DjangoComment = {
  id: number;
  text: string;
  author: DjangoTaskUserRef;
  created_at: string;
};

export type DjangoActivity = {
  id: number;
  task: number;
  author: DjangoTaskUserRef;
  reason: string;
  start_time: string | null;
  end_time: string | null;
  duration: number;
  description: string;
  is_retroactive: boolean;
  activity_date: string | null;
  admin_comment: string | null;
  modified_by_admin: boolean;
  modified_at: string | null;
  comment_count: number;
  created_at: string;
};

export type DjangoActivityComment = {
  id: number;
  activity: number;
  author: DjangoTaskUserRef;
  text: string;
  created_at: string;
};

export type DjangoActivityReason = {
  id: number;
  key: string;
  label: string;
  description: string;
  is_active: boolean;
  is_archived: boolean;
  archived_at: string | null;
  assigned_roles: string[];
  created_at: string;
  updated_at: string;
};

export type DjangoTargetTimeAuditEntry = {
  id: number;
  user: DjangoTaskUserRef;
  user_role: string;
  previous_value: number | null;
  new_value: number;
  reason: string;
  reason_detail: string | null;
  created_at: string;
};

export type DjangoTargetTimeInfo = {
  estimated_hours: number;
  target_time_validated: number | null;
  target_time_validated_at: string | null;
  validated_by: DjangoTaskUserRef | null;
  is_validated: boolean;
  official_target: number;
  real_hours: number;
  deviation: { hours: number; pct: number | null };
  can_validate: boolean;
  audit_history: DjangoTargetTimeAuditEntry[];
  historical_deviation: {
    available: boolean;
    reason?: string;
    sample_size?: number;
    avg_real_hours?: number;
    diff_pct?: number;
    recommendation?: string;
  };
};

export type DjangoEndDateAuditEntry = {
  id: number;
  user: DjangoTaskUserRef;
  user_role: string;
  action: string;
  previous_value: string | null;
  new_value: string | null;
  observaciones: string | null;
  created_at: string;
};

export type DjangoEndDateInfo = {
  end_date: string;
  end_date_approval_status: string;
  end_date_approved_at: string | null;
  approved_by: DjangoTaskUserRef | null;
  can_validate: boolean;
  audit_history: DjangoEndDateAuditEntry[];
};

function userRefName(user: DjangoTaskUserRef): string {
  return user.first_name || user.username;
}

function userRefRole(user: DjangoTaskUserRef): string {
  return user.roles[0]?.name ?? "";
}

export function mapDjangoTaskToNexoShape(task: DjangoTask) {
  return {
    id: String(task.id),
    title: task.title,
    description: task.description || null,
    type: task.type,
    status: task.status,
    priority: task.priority,
    frequency: task.frequency,
    startDate: task.start_date,
    endDate: task.end_date,
    estimatedHours: task.estimated_hours,
    realHours: task.real_hours,
    targetTimeValidated: task.target_time_validated,
    progress: task.progress,
    color: task.color || null,
    corrected: task.corrected,
    assignedTo: {
      id: String(task.assigned_to.id),
      name: userRefName(task.assigned_to),
      email: task.assigned_to.email,
      role: userRefRole(task.assigned_to),
    },
    createdBy: { id: String(task.created_by.id), name: userRefName(task.created_by) },
    _count: { comments: task.comment_count },
    hasUnreadComments: task.has_unread_comments,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

export function mapDjangoCommentToNexoShape(comment: DjangoComment) {
  return {
    id: String(comment.id),
    text: comment.text,
    author: {
      id: String(comment.author.id),
      name: userRefName(comment.author),
      role: userRefRole(comment.author),
    },
    createdAt: comment.created_at,
  };
}

/** Fase 3f (ver docs/AUDIT_LOG.md § 2026-08-07): `adminComment`/
 * `modifiedByAdmin`/`modifiedAt`/`_count.comments` ya son valores reales
 * (antes gaps documentados de la Fase 3b). */
export function mapDjangoActivityToNexoShape(activity: DjangoActivity) {
  return {
    id: String(activity.id),
    reason: activity.reason,
    startTime: activity.start_time,
    endTime: activity.end_time,
    duration: activity.duration,
    description: activity.description || null,
    isRetroactive: activity.is_retroactive,
    activityDate: activity.activity_date,
    adminComment: activity.admin_comment,
    modifiedByAdmin: activity.modified_by_admin,
    modifiedAt: activity.modified_at,
    author: { id: String(activity.author.id), name: userRefName(activity.author) },
    createdAt: activity.created_at,
    _count: { comments: activity.comment_count },
  };
}

export function mapDjangoActivityCommentToNexoShape(comment: DjangoActivityComment) {
  return {
    id: String(comment.id),
    text: comment.text,
    author: {
      id: String(comment.author.id),
      name: userRefName(comment.author),
      role: userRefRole(comment.author),
    },
    createdAt: comment.created_at,
  };
}

export function mapDjangoActivityReasonToNexoShape(reason: DjangoActivityReason) {
  return {
    id: String(reason.id),
    key: reason.key,
    label: reason.label,
    description: reason.description || null,
    isActive: reason.is_active,
    isArchived: reason.is_archived,
    archivedAt: reason.archived_at,
    assignedRoles: reason.assigned_roles,
    createdAt: reason.created_at,
    updatedAt: reason.updated_at,
  };
}

export function mapDjangoTargetTimeInfoToNexoShape(info: DjangoTargetTimeInfo) {
  return {
    estimatedHours: info.estimated_hours,
    targetTimeValidated: info.target_time_validated,
    targetTimeValidatedAt: info.target_time_validated_at,
    validatedBy: info.validated_by
      ? { id: String(info.validated_by.id), name: userRefName(info.validated_by) }
      : null,
    isValidated: info.is_validated,
    officialTarget: info.official_target,
    realHours: info.real_hours,
    deviation: info.deviation,
    canValidate: info.can_validate,
    auditHistory: info.audit_history.map((entry) => ({
      id: String(entry.id),
      previousValue: entry.previous_value,
      newValue: entry.new_value,
      reason: entry.reason,
      reasonDetail: entry.reason_detail,
      user: { id: String(entry.user.id), name: userRefName(entry.user) },
      userRole: entry.user_role,
      createdAt: entry.created_at,
    })),
    historicalDeviation: {
      available: info.historical_deviation.available,
      reason: info.historical_deviation.reason,
      sampleSize: info.historical_deviation.sample_size,
      avgRealHours: info.historical_deviation.avg_real_hours,
      diffPct: info.historical_deviation.diff_pct,
      recommendation: info.historical_deviation.recommendation,
    },
  };
}

export function mapDjangoEndDateInfoToNexoShape(info: DjangoEndDateInfo) {
  return {
    endDate: info.end_date,
    endDateApprovalStatus: info.end_date_approval_status,
    endDateApprovedAt: info.end_date_approved_at,
    approvedBy: info.approved_by ? { id: String(info.approved_by.id), name: userRefName(info.approved_by) } : null,
    canValidate: info.can_validate,
    auditHistory: info.audit_history.map((entry) => ({
      id: String(entry.id),
      action: entry.action,
      previousValue: entry.previous_value,
      newValue: entry.new_value,
      observaciones: entry.observaciones,
      user: { id: String(entry.user.id), name: userRefName(entry.user) },
      userRole: entry.user_role,
      createdAt: entry.created_at,
    })),
  };
}

/** Sub-fase 3c-bulk (ver docs/AUDIT_LOG.md § 2026-08-07): pantalla
 * combinada de pendientes de regularizar + % de calidad del dato. */
export type DjangoDataQuality = {
  validated_count: number;
  pending_count: number;
  total_count: number;
  validated_pct: number;
  pending_pct: number;
};

export type DjangoPendingTask = {
  id: number;
  title: string;
  status: string;
  type: string;
  priority: string;
  start_date: string;
  estimated_hours: number;
  real_hours: number;
  target_time_validated: number | null;
  end_date: string;
  end_date_approval_status: string;
  archived_month: string | null;
  assigned_to: DjangoTaskUserRef;
};

export type DjangoPendingValidationsResponse = {
  tasks: DjangoPendingTask[];
  target_time_data_quality: DjangoDataQuality;
  end_date_data_quality: DjangoDataQuality;
};

function mapDjangoDataQuality(quality: DjangoDataQuality) {
  return {
    validatedCount: quality.validated_count,
    pendingCount: quality.pending_count,
    totalCount: quality.total_count,
    validatedPct: quality.validated_pct,
    pendingPct: quality.pending_pct,
  };
}

export function mapDjangoPendingValidationsToNexoShape(data: DjangoPendingValidationsResponse) {
  return {
    tasks: data.tasks.map((task) => ({
      id: String(task.id),
      title: task.title,
      status: task.status,
      type: task.type,
      priority: task.priority,
      startDate: task.start_date,
      estimatedHours: task.estimated_hours,
      realHours: task.real_hours,
      targetTimeValidated: task.target_time_validated,
      endDate: task.end_date,
      endDateApprovalStatus: task.end_date_approval_status,
      archivedMonth: task.archived_month,
      assignedTo: {
        id: String(task.assigned_to.id),
        name: userRefName(task.assigned_to),
        role: userRefRole(task.assigned_to),
      },
    })),
    targetTimeDataQuality: mapDjangoDataQuality(data.target_time_data_quality),
    endDateDataQuality: mapDjangoDataQuality(data.end_date_data_quality),
  };
}

/** Devuelve `null` cuando el actor no tiene `CanRegularize` (único motivo
 * real de fallo en este GET, sin cuerpo que pueda fallar validación) y
 * `"no_session"` cuando no hay sesión Django disponible. */
export async function fetchDjangoPendingValidations(params: {
  userId?: string;
  role?: string;
  type?: string;
}): Promise<DjangoPendingValidationsResponse | null | "no_session"> {
  const query = new URLSearchParams();
  if (params.userId) query.set("user_id", params.userId);
  if (params.role) query.set("role", params.role);
  if (params.type) query.set("type", params.type);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await djangoApiFetch(`/tasks/validations/pending/${suffix}`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

/** Devuelve `null` cuando no hay sesión Django disponible — el llamador
 * decide cómo responder (ver `DJANGO_SESSION_REQUIRED_MESSAGE`). */
export async function fetchOwnDjangoTasks(): Promise<DjangoTask[] | null> {
  const response = await djangoApiFetch("/tasks/");
  if (!response || !response.ok) return null;
  return response.json();
}

export async function fetchDjangoTask(id: string): Promise<DjangoTask | null | "no_session"> {
  const response = await djangoApiFetch(`/tasks/${id}/`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

export async function fetchDjangoActivityReasons(): Promise<DjangoActivityReason[] | null> {
  const response = await djangoApiFetch("/activity-reasons/");
  if (!response || !response.ok) return null;
  return response.json();
}

export async function fetchDjangoTargetTimeInfo(
  taskId: string
): Promise<DjangoTargetTimeInfo | null | "no_session"> {
  const response = await djangoApiFetch(`/tasks/${taskId}/target-time/`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

export async function fetchDjangoEndDateInfo(taskId: string): Promise<DjangoEndDateInfo | null | "no_session"> {
  const response = await djangoApiFetch(`/tasks/${taskId}/end-date/`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

/**
 * Resuelve el id NUMÉRICO de Django del usuario en sesión (los componentes
 * de Tareas comparan `currentUserId` contra `task.assignedTo.id`/
 * `task.createdBy.id`, también numéricos). `null` cuando no hay sesión
 * Django disponible (el llamador debe degradar, no romper la página).
 */
export async function fetchDjangoCurrentUserId(): Promise<string | null> {
  const response = await djangoApiFetch("/auth/me/");
  if (!response || !response.ok) return null;
  const data = (await response.json()) as { id: number };
  return String(data.id);
}

/**
 * Sub-fase 3d (ver docs/AUDIT_LOG.md § 2026-08-07): Motor de Cierre
 * Inteligente. `already_closed`/`closure_type`/etc. usan snake_case desde
 * Django — se reacomodan al camelCase que ya espera `CloseMonthModal.tsx`.
 */
export type DjangoMonthClosurePreview = {
  year: number;
  month: number;
  already_closed: boolean;
  total: number;
  completed: number;
  pending: number;
  in_progress: number;
  continued_active: number;
  cutoff_date: string;
  closure_type: "NORMAL" | "EARLY" | "MANUAL";
  calendar_days_total: number;
  calendar_days_considered: number;
  working_days_considered: number;
  working_hours_considered: number;
};

export type DjangoMonthClosureResult = {
  archived_count: number;
  duplicated_count: number;
  continued_active_count: number;
  month: number;
  year: number;
  next_month: number;
  next_year: number;
  cutoff_date: string;
  closure_type: "NORMAL" | "EARLY" | "MANUAL";
  calendar_days_total: number;
  calendar_days_considered: number;
  working_days_considered: number;
  working_hours_considered: number;
};

export function mapDjangoMonthClosurePreviewToNexoShape(preview: DjangoMonthClosurePreview) {
  return {
    year: preview.year,
    month: preview.month,
    alreadyClosed: preview.already_closed,
    total: preview.total,
    completed: preview.completed,
    pending: preview.pending,
    inProgress: preview.in_progress,
    continuedActive: preview.continued_active,
    cutoffDate: preview.cutoff_date,
    closureType: preview.closure_type,
    calendarDaysTotal: preview.calendar_days_total,
    calendarDaysConsidered: preview.calendar_days_considered,
    workingDaysConsidered: preview.working_days_considered,
    workingHoursConsidered: preview.working_hours_considered,
  };
}

export function mapDjangoMonthClosureResultToNexoShape(result: DjangoMonthClosureResult) {
  return {
    archivedCount: result.archived_count,
    duplicatedCount: result.duplicated_count,
    continuedActiveCount: result.continued_active_count,
    month: result.month,
    year: result.year,
    nextMonth: result.next_month,
    nextYear: result.next_year,
    cutoffDate: result.cutoff_date,
    closureType: result.closure_type,
    calendarDaysTotal: result.calendar_days_total,
    calendarDaysConsidered: result.calendar_days_considered,
    workingDaysConsidered: result.working_days_considered,
    workingHoursConsidered: result.working_hours_considered,
  };
}

/** `null` cuando el actor no tiene `CanCloseMonth` (`usuarios.editar`) o
 * la fecha de corte es inválida (ambos casos, sin cuerpo que distinguir
 * aquí — el llamador usa el status HTTP real, no este valor, para
 * diferenciarlos). `"no_session"` cuando no hay sesión Django. */
export async function fetchDjangoCloseMonthPreview(params: {
  year?: string;
  month?: string;
  cutoffDate?: string;
}): Promise<{ data: DjangoMonthClosurePreview | null; status: number } | "no_session"> {
  const query = new URLSearchParams();
  if (params.year) query.set("year", params.year);
  if (params.month) query.set("month", params.month);
  if (params.cutoffDate) query.set("cutoffDate", params.cutoffDate);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await djangoApiFetch(`/tasks/close-month/${suffix}`);
  if (!response) return "no_session";
  if (!response.ok) return { data: null, status: response.status };
  return { data: await response.json(), status: response.status };
}

export type DjangoRepositoryMonth = {
  year: number;
  month: number;
  total_tasks: number;
  completed_tasks: number;
  total_hours: number;
};

export function mapDjangoRepositoryMonthsToNexoShape(months: DjangoRepositoryMonth[]) {
  return months.map((m) => ({
    year: m.year,
    month: m.month,
    totalTasks: m.total_tasks,
    completedTasks: m.completed_tasks,
    totalHours: m.total_hours,
  }));
}

export async function fetchDjangoRepositoryMonths(): Promise<DjangoRepositoryMonth[] | null | "no_session"> {
  const response = await djangoApiFetch("/tasks/repository/");
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

export async function fetchDjangoRepositoryTasks(
  year: string,
  month: string
): Promise<DjangoTask[] | null | "no_session"> {
  const response = await djangoApiFetch(`/tasks/repository/${year}/${month}/`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}
