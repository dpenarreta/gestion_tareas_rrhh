import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canViewTeam } from "@/lib/roles";
import { fetchDjangoCurrentUserId } from "@/lib/djangoTasksAdapter";
import TeamModule from "@/components/team/TeamModule";

// Bug encontrado en prueba integral en Chrome real (2026-08-31): esta
// página pasaba el cuid de Postgres (`session.userId`) como `currentUserId`
// a `CommentPanel`/`ActivityPanel` (reusados de Tareas, que sí reciben el id
// numérico de Django correcto vía `tasks/page.tsx`, Fase 55) — rompía la
// detección de autoría propia de comentarios/actividades al ver el trabajo
// de un subordinado desde Equipo. Mismo fix que Tareas/Proyectos/Reuniones.
export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canViewTeam(session.role)) redirect("/dashboard");

  const djangoUserId = await fetchDjangoCurrentUserId();

  return (
    <Suspense fallback={null}>
      <TeamModule currentUserId={djangoUserId ?? session.userId} currentUserRole={session.role} />
    </Suspense>
  );
}
