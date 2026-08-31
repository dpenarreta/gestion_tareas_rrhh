import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canCreateMeetings } from "@/lib/roles";
import { fetchDjangoCurrentUserId } from "@/lib/djangoTasksAdapter";
import MeetingsModule from "@/components/meetings/MeetingsModule";

// Bug encontrado en prueba integral en Chrome real (2026-08-31): esta
// página pasaba el cuid de Postgres (`session.userId`) como `currentUserId`,
// pero `meeting.hostId`/la lista de `users/assignable` ya usan el id
// numérico de Django desde la Fase 42 — `isHost` (`MeetingsModule.tsx`)
// nunca coincidía (nunca veías los controles de anfitrión en tus propias
// reuniones) y el filtro "excluirme a mí mismo" del selector de invitados
// tampoco funcionaba. Mismo fix que Tareas (Fase 55) y Proyectos.
export default async function MeetingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const djangoUserId = await fetchDjangoCurrentUserId();

  return (
    <MeetingsModule
      currentUserId={djangoUserId ?? session.userId}
      canCreate={canCreateMeetings(session.role)}
    />
  );
}
