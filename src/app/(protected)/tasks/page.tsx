import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { getActivityFormat } from "@/lib/activityFormat";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchOwnDjangoTasks, fetchDjangoCurrentUserId, mapDjangoTaskToNexoShape } from "@/lib/djangoTasksAdapter";
import { fetchAllDjangoUsers, mapDjangoUserToNexoShape } from "@/lib/djangoUsersAdapter";
import TasksModule from "@/components/tasks/TasksModule";
import type { ViewType } from "@/components/tasks/types";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // El Jefe Nacional no gestiona tareas propias — el módulo Trabajo está oculto
  // en el navbar (ver src/lib/navLinks.ts) y esta ruta no debe ser accesible
  // directamente tampoco.
  if (session.role === "JEFE_NACIONAL") redirect("/dashboard");

  const visibleRoles = getVisibleRoles(session.role);

  // Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 55): cierra
  // el gap explícito documentado desde la Fase 3a — `view_preferences` ya
  // vive en Django (`GET /users/<id>/view-preferences/`), así que
  // `currentUserId` pasa a ser el id numérico de Django (antes era el cuid
  // de Postgres, porque este mismo endpoint seguía comparando contra
  // `session.userId`). Si no hay sesión Django todavía (puente no
  // establecido para esta sesión), se degrada a listas vacías/valores por
  // defecto — nunca rompe la página.
  const [djangoUserId, djangoTasks, djangoUsers] = await Promise.all([
    fetchDjangoCurrentUserId(),
    fetchOwnDjangoTasks(),
    fetchAllDjangoUsers(),
  ]);

  const viewPreferencesResponse = djangoUserId ? await djangoApiFetch(`/users/${djangoUserId}/view-preferences/`) : null;
  const viewPreferences: string[] =
    viewPreferencesResponse?.ok ? ((await viewPreferencesResponse.json()) as { view_preferences: string[] }).view_preferences : [];

  const serializedTasks = (djangoTasks ?? []).map(mapDjangoTaskToNexoShape);
  const assignableUsers = (djangoUsers ?? [])
    .map(mapDjangoUserToNexoShape)
    .filter((u) => visibleRoles.includes(u.role))
    .sort((a, b) => a.name.localeCompare(b.name));

  const VALID_VIEWS: ViewType[] = ["KANBAN", "TABLA", "GANTT"];
  const taskViews = viewPreferences.filter((v) => VALID_VIEWS.includes(v as ViewType)) as ViewType[];

  const currentActivityFormat = getActivityFormat(viewPreferences);

  return (
    <div>
      <Suspense fallback={null}>
        <TasksModule
          initialTasks={serializedTasks}
          initialViews={taskViews.length > 0 ? taskViews : ["KANBAN", "TABLA"]}
          initialUsers={assignableUsers}
          currentUserId={djangoUserId ?? session.userId}
          currentUserRole={session.role}
          currentActivityFormat={currentActivityFormat}
        />
      </Suspense>
    </div>
  );
}
