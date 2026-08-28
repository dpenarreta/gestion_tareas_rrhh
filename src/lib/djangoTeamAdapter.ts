import "server-only";

/**
 * Adaptador entre la forma de Equipo de Django (Fase 18 del backend,
 * cutover de stack Fase 46, ver docs/AUDIT_LOG.md § 2026-08-24) y
 * `src/components/team/TeamModule.tsx` (sin cambios). Mismo patrón que
 * `djangoIdeasAdapter.ts`/`djangoMeetingsAdapter.ts`.
 */

export type DjangoTeamMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  tasks: { total: number; completed: number; in_progress: number; pending: number };
};

export function mapDjangoTeamMemberToNexoShape(m: DjangoTeamMember) {
  return {
    id: String(m.id),
    name: m.name,
    email: m.email,
    role: m.role,
    tasks: {
      total: m.tasks.total,
      completed: m.tasks.completed,
      inProgress: m.tasks.in_progress,
      pending: m.tasks.pending,
    },
  };
}

type DjangoTeamTaskUserRef = { id: number; name: string; email: string; role: string };

export type DjangoTeamMemberTask = {
  id: number;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  frequency: string;
  start_date: string;
  end_date: string;
  estimated_hours: number;
  real_hours: number;
  target_time_validated: boolean;
  progress: number;
  color: string | null;
  corrected: boolean;
  assigned_to: DjangoTeamTaskUserRef;
  created_by: { id: number; name: string };
  comment_count: number;
  created_at: string;
  updated_at: string;
};

export function mapDjangoTeamMemberTaskToNexoShape(t: DjangoTeamMemberTask) {
  return {
    id: String(t.id),
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    priority: t.priority,
    frequency: t.frequency,
    startDate: t.start_date,
    endDate: t.end_date,
    estimatedHours: t.estimated_hours,
    realHours: t.real_hours,
    targetTimeValidated: t.target_time_validated,
    progress: t.progress,
    color: t.color,
    corrected: t.corrected,
    assignedTo: {
      id: String(t.assigned_to.id),
      name: t.assigned_to.name,
      email: t.assigned_to.email,
      role: t.assigned_to.role,
    },
    createdBy: { id: String(t.created_by.id), name: t.created_by.name },
    _count: { comments: t.comment_count },
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}
