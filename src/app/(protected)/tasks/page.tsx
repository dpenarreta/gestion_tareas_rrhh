import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getActivityFormat } from "@/lib/activityFormat";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchOwnDjangoTasks, fetchDjangoCurrentUserId, mapDjangoTaskToNexoShape } from "@/lib/djangoTasksAdapter";
import { fetchDjangoAssignableUsers } from "@/lib/djangoUsersAdapter";
import TasksModule from "@/components/tasks/TasksModule";
import type { ViewType } from "@/components/tasks/types";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // El Jefe Nacional no gestiona tareas propias — el módulo Trabajo está oculto
  // en el navbar (ver src/lib/navLinks.ts) y esta ruta no debe ser accesible
  // directamente tampoco.
  if (session.role === "JEFE_NACIONAL") redirect("/dashboard");

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
    fetchDjangoAssignableUsers(),
  ]);

  const viewPreferencesResponse = djangoUserId ? await djangoApiFetch(`/users/${djangoUserId}/view-preferences/`) : null;
  const viewPreferences: string[] =
    viewPreferencesResponse?.ok ? ((await viewPreferencesResponse.json()) as { view_preferences: string[] }).view_preferences : [];

  const serializedTasks = (djangoTasks ?? []).map(mapDjangoTaskToNexoShape);
  // Quién es asignable lo decide Django (`get_visible_groups`), que ya
  // incluye al propio usuario. Antes esta lista salía de `/admin/users/`
  // filtrada acá con `VISIBLE_ROLES`: a quien no tuviera permiso
  // administrativo ese endpoint le respondía 403, la lista quedaba vacía y
  // el selector "Asignado a" no ofrecía ninguna opción — ni siquiera uno
  // mismo—, de modo que no podía crear tareas (ver docs/AUDIT_LOG.md §
  // 2026-09-14).
  const assignableUsers = (djangoUsers ?? []).sort((a, b) => a.name.localeCompare(b.name));

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
          currentUserId={djangoUserId ?? String(session.djangoUserId)}
          currentUserRole={session.role}
          currentActivityFormat={currentActivityFormat}
        />
      </Suspense>
    </div>
  );
}
