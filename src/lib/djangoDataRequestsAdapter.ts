import "server-only";

/**
 * Adaptador entre la forma de Solicitudes LOPD de Django (Fase 12 del
 * backend, cutover de stack Fase 45, ver docs/AUDIT_LOG.md § 2026-08-24) y
 * `src/components/settings/DataRequestsSection.tsx` (sin cambios). Mismo
 * patrón que `djangoIdeasAdapter.ts`/`djangoMeetingsAdapter.ts`.
 */

// Cutover de stack — Fase 90 (ver docs/AUDIT_LOG.md § 2026-08-28): ya no se
// importan del cliente Prisma generado (retirado del repo) — mismos
// valores que `prisma/schema.prisma` tenía, réplica exacta de
// `DataSubjectRequest.type`/`.status` (Django).
export type DataRequestType = "ACCESO" | "RECTIFICACION" | "ELIMINACION";
export type DataRequestStatus = "PENDIENTE" | "EN_PROCESO" | "RESUELTA";

type DjangoDataRequestUserRef = {
  id: number;
  username: string;
  first_name: string;
  email: string;
  roles: { id: number; name: string }[];
};

function userRefName(user: DjangoDataRequestUserRef): string {
  return user.first_name || user.username;
}

export type DjangoDataSubjectRequest = {
  id: number;
  user_id: number;
  type: string;
  description: string | null;
  status: string;
  resolved_by_id: number | null;
  resolved_at: string | null;
  created_at: string;
  user?: DjangoDataRequestUserRef;
  resolver?: { id: number; first_name: string } | null;
};

export function mapDjangoDataRequestToNexoShape(r: DjangoDataSubjectRequest) {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    type: r.type,
    description: r.description,
    status: r.status,
    resolvedBy: r.resolved_by_id !== null ? String(r.resolved_by_id) : null,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    ...(r.user && {
      user: { id: String(r.user.id), name: userRefName(r.user), email: r.user.email, role: r.user.roles[0]?.name ?? "" },
    }),
    ...(r.resolver !== undefined && {
      resolver: r.resolver ? { id: String(r.resolver.id), name: r.resolver.first_name } : null,
    }),
  };
}

// --- GET /data-requests/my-data/ ------------------------------------------

type DjangoMyDataExport = {
  generado_el: string;
  usuario: {
    id: number;
    username: string;
    first_name: string;
    email: string;
    roles: string[];
    last_login: string | null;
    created_at: string;
  };
  tareas: {
    id: number; title: string; description: string; status: string; priority: string; frequency: string;
    type: string; start_date: string; end_date: string; estimated_hours: number; real_hours: number;
    progress: number; completed_at: string | null; created_at: string;
  }[];
  actividades: {
    id: number; task_id: number; reason: string; start_time: string | null; end_time: string | null;
    duration: number; description: string | null; created_at: string;
  }[];
  comentarios: { id: number; task_id: number; text: string; created_at: string }[];
  reuniones_organizadas: { id: number; title: string; meeting_date: string; duration: number; status: string }[];
  reuniones_invitado: { attended: boolean; meeting_id: number; meeting__title: string; meeting__meeting_date: string }[];
  ideas_propuestas: {
    id: number; title: string; description: string; impact: string; status: string; progress: number; created_at: string;
  }[];
  votos_en_ideas: { idea_id: number; created_at: string }[];
  solicitudes_previas: {
    id: number; type: string; status: string; description: string | null; created_at: string; resolved_at: string | null;
  }[];
  permisos_y_ausencias: {
    id: number; type: string; date: string; is_full_day: boolean; duration_minutes: number | null;
    observation: string | null; created_at: string;
  }[];
  estado_especial: {
    id: number; type: string; start_date: string; end_date: string | null; is_active: boolean;
    daily_hours: number; limit_low: number; limit_base: number; limit_high: number; limit_overload: number;
    created_at: string;
  }[];
};

/**
 * Réplica del `exportPayload` de `my-data/route.ts`. Gap heredado del
 * backend (ver `apps.data_requests.services.export_my_data`, Fase 12):
 * `usuario` no trae `theme`/`viewPreferences`/`badges`/`dataConsentAccepted`/
 * `dataConsentAcceptedAt` — ninguno de esos campos existe todavía en el
 * `User` de Django (gaps ya documentados en fases previas: Fase 6b para
 * theme/viewPreferences, Fase 11 para badges; consent fuera de alcance).
 * Se omiten de la exportación en vez de fabricar valores falsos — mismo
 * criterio que el backend.
 *
 * `permisosYAusencias`/`estadoEspecial` — hallazgo de la auditoría de
 * datos personales (ver docs/AUDIT_LOG.md § 2026-09-02): agregados junto
 * con el backend (`export_my_data`) porque antes de esta corrección
 * `LeaveRecord`/`SpecialStatus` del propio titular no llegaban a esta
 * exportación pese a que el backend ya los devuelve — saltear este
 * adaptador habría dejado los campos nuevos de Django sin mapear y por
 * lo tanto ausentes igual del JSON final (ver `.claude/rules/architecture.md`).
 */
export function mapDjangoMyDataExportToNexoShape(data: DjangoMyDataExport) {
  return {
    generadoEl: data.generado_el,
    usuario: {
      id: String(data.usuario.id),
      name: data.usuario.first_name || data.usuario.username,
      email: data.usuario.email,
      role: data.usuario.roles[0] ?? null,
      lastLoginAt: data.usuario.last_login,
      createdAt: data.usuario.created_at,
    },
    tareas: data.tareas.map((t) => ({
      id: String(t.id),
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      frequency: t.frequency,
      type: t.type,
      startDate: t.start_date,
      endDate: t.end_date,
      estimatedHours: t.estimated_hours,
      realHours: t.real_hours,
      progress: t.progress,
      completedAt: t.completed_at,
      createdAt: t.created_at,
    })),
    actividades: data.actividades.map((a) => ({
      id: String(a.id),
      taskId: String(a.task_id),
      reason: a.reason,
      startTime: a.start_time,
      endTime: a.end_time,
      duration: a.duration,
      description: a.description,
      createdAt: a.created_at,
    })),
    comentarios: data.comentarios.map((c) => ({
      id: String(c.id),
      taskId: String(c.task_id),
      text: c.text,
      createdAt: c.created_at,
    })),
    reunionesOrganizadas: data.reuniones_organizadas.map((m) => ({
      id: String(m.id),
      title: m.title,
      meetingDate: m.meeting_date,
      duration: m.duration,
      status: m.status,
    })),
    reunionesInvitado: data.reuniones_invitado.map((mi) => ({
      attended: mi.attended,
      meeting: { id: String(mi.meeting_id), title: mi.meeting__title, meetingDate: mi.meeting__meeting_date },
    })),
    ideasPropuestas: data.ideas_propuestas.map((i) => ({
      id: String(i.id),
      title: i.title,
      description: i.description,
      impact: i.impact,
      status: i.status,
      progress: i.progress,
      createdAt: i.created_at,
    })),
    votosEnIdeas: data.votos_en_ideas.map((v) => ({ ideaId: String(v.idea_id), createdAt: v.created_at })),
    solicitudesPrevias: data.solicitudes_previas.map((r) => ({
      id: String(r.id),
      type: r.type,
      status: r.status,
      description: r.description,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    })),
    permisosYAusencias: data.permisos_y_ausencias.map((l) => ({
      id: String(l.id),
      type: l.type,
      date: l.date,
      isFullDay: l.is_full_day,
      durationMinutes: l.duration_minutes,
      observation: l.observation,
      createdAt: l.created_at,
    })),
    estadoEspecial: data.estado_especial.map((s) => ({
      id: String(s.id),
      type: s.type,
      startDate: s.start_date,
      endDate: s.end_date,
      isActive: s.is_active,
      dailyHours: s.daily_hours,
      limitLow: s.limit_low,
      limitBase: s.limit_base,
      limitHigh: s.limit_high,
      limitOverload: s.limit_overload,
      createdAt: s.created_at,
    })),
  };
}
