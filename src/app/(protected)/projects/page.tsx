import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canCreateProject, canManageUsers, getSubordinateRoles } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoProjectListItemToNexoShape, type DjangoProjectListItem } from "@/lib/djangoProjectsAdapter";
import { fetchAllDjangoUsers, mapDjangoUserToNexoShape } from "@/lib/djangoUsersAdapter";
import ProjectsModule from "@/components/projects/ProjectsModule";

// Cutover de stack — Fase 86 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica
// de `GET /api/projects` (Django completo desde la Fase 5f) llamado
// directo desde la página, mismo patrón que `tasks/page.tsx`. El filtro de
// visibilidad por rol (antes el `OR` de responsable/creador/participante)
// ya lo aplica `ProjectViewSet.get_queryset` server-side. `candidateUsers`
// reusa el mismo `fetchAllDjangoUsers` + filtro por jerarquía que ya usa
// `tasks/page.tsx` para `assignableUsers`. Si Django no responde, ambas
// listas degradan a vacías en vez de romper la página.
export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [projectsResponse, djangoUsers] = await Promise.all([djangoApiFetch("/projects/"), fetchAllDjangoUsers()]);

  const serialized =
    projectsResponse?.ok ? ((await projectsResponse.json()) as DjangoProjectListItem[]).map(mapDjangoProjectListItemToNexoShape) : [];

  const canSeeRealEmails = canManageUsers(session.role);
  const visibleRoles = canManageUsers(session.role) ? null : getSubordinateRoles(session.role);
  const serializedCandidates = (djangoUsers ?? [])
    .map(mapDjangoUserToNexoShape)
    .filter((u) => visibleRoles === null || visibleRoles.includes(u.role))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ ...u, email: maskEmailUnless(u.email, canSeeRealEmails) }));

  return (
    <ProjectsModule
      initialProjects={serialized}
      currentUserId={session.userId}
      currentUserName={session.name}
      candidateUsers={serializedCandidates}
      canCreate={canCreateProject(session.role)}
    />
  );
}
