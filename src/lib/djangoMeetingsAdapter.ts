import "server-only";

/**
 * Adaptador entre la forma de Reuniones de Django (Fase 10 del backend,
 * cutover de stack Fase 42, ver docs/AUDIT_LOG.md § 2026-08-21) y
 * `src/components/meetings/*` (sin cambios). Mismo patrón que
 * `djangoProjectsAdapter.ts`/`djangoTasksAdapter.ts`.
 */

type DjangoMeetingUserRef = {
  id: number;
  username: string;
  first_name: string;
  email: string;
  roles: { id: number; name: string }[];
};

function userRefName(user: DjangoMeetingUserRef): string {
  return user.first_name || user.username;
}

function userRefRole(user: DjangoMeetingUserRef): string {
  return user.roles[0]?.name ?? "";
}

function toUserRef(user: DjangoMeetingUserRef) {
  return { id: String(user.id), name: userRefName(user), role: userRefRole(user) };
}

export type DjangoMeetingInvitee = {
  id: number;
  user: DjangoMeetingUserRef;
  attended: boolean;
};

export type DjangoMeeting = {
  id: number;
  title: string;
  description: string | null;
  host: DjangoMeetingUserRef;
  meeting_date: string;
  duration: number;
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  zoom_password: string | null;
  status: string;
  otter_invited: boolean;
  otter_summary: string | null;
  otter_transcript_url: string | null;
  created_at: string;
  updated_at: string;
  invitees: DjangoMeetingInvitee[];
};

export function mapDjangoMeetingToNexoShape(meeting: DjangoMeeting) {
  return {
    id: String(meeting.id),
    title: meeting.title,
    description: meeting.description,
    hostId: String(meeting.host.id),
    host: toUserRef(meeting.host),
    meetingDate: meeting.meeting_date,
    duration: meeting.duration,
    zoomMeetingId: meeting.zoom_meeting_id,
    zoomJoinUrl: meeting.zoom_join_url,
    zoomPassword: meeting.zoom_password,
    status: meeting.status,
    otterInvited: meeting.otter_invited,
    otterSummary: meeting.otter_summary,
    otterTranscriptUrl: meeting.otter_transcript_url,
    createdAt: meeting.created_at,
    updatedAt: meeting.updated_at,
    invitees: meeting.invitees.map((inv) => ({
      id: String(inv.id),
      userId: String(inv.user.id),
      attended: inv.attended,
      user: toUserRef(inv.user),
    })),
  };
}

/**
 * Extrae el mensaje de `{"error": "mensaje"}` — `MeetingListCreateView`/
 * `MeetingDetailView` construyen su `Response` de error a mano (contrato
 * plano), igual que `apps.configuration` — no pasan por el manejador global
 * de excepciones de `apps.core.exceptions`.
 */
export async function extractDjangoMeetingErrorMessage(response: Response): Promise<string | undefined> {
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : undefined;
}
