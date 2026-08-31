import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canManageUsers, getVisibleRoles, ROLE_LEVEL } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import { mapDjangoProjectDetailToNexoShape, type DjangoProjectDetail } from "@/lib/djangoProjectsAdapter";
import { fetchAllDjangoUsers, mapDjangoUserToNexoShape } from "@/lib/djangoUsersAdapter";
import ProjectDetailView from "@/components/projects/ProjectDetailView";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Cutover de stack — Fase 86 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica
 * de `GET /api/projects/[id]` (Django completo desde la Fase 5f) llamado
 * directo desde la página. Cierra `projectPhaseStats.ts` (sus 2 funciones
 * ya están resueltas en `mapDjangoProjectDetailToNexoShape`) y
 * `projectAccess.ts` (sin otro consumidor tras este cutover — Django ya
 * hace el control de acceso de `canViewProject` server-side vía
 * `CanAccessProject`, así que un 403/404 acá colapsa a `notFound()` igual
 * que antes; `isProjectManager`/`isProjectCreator` se recalculan acá
 * comparando el id NUMÉRICO de Django, porque `mapped.responsible.id`/
 * `createdBy.id` ya no son el cuid de Postgres de `session.userId`).
 */
export default async function ProjectDetailPage({ params }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const [projectResponse, djangoUserId] = await Promise.all([
    djangoApiFetch(`/projects/${id}/`),
    resolveDjangoUserId(session),
  ]);
  if (!projectResponse || !projectResponse.ok) notFound();

  const project: DjangoProjectDetail = await projectResponse.json();
  const mapped = mapDjangoProjectDetailToNexoShape(project);

  const isLeadership = ROLE_LEVEL[session.role] >= 3;
  const djangoUserIdStr = djangoUserId !== null ? String(djangoUserId) : null;
  const isResponsibleOrCreator =
    djangoUserIdStr !== null && (djangoUserIdStr === mapped.responsible.id || djangoUserIdStr === mapped.createdBy.id);
  const canManage = isLeadership || isResponsibleOrCreator;
  const canDelete = djangoUserIdStr !== null && djangoUserIdStr === mapped.createdBy.id;

  // Solo se envía el directorio de usuarios al cliente si puede gestionar
  // participantes — y acotado a su jerarquía visible salvo que sea liderazgo
  // (nivel >= 3), igual que en el resto de la app (evita filtrar nombres/roles
  // de toda la organización a quien solo es responsable de un proyecto puntual).
  const visibleRoles = canManageUsers(session.role) ? null : getVisibleRoles(session.role);
  const djangoUsers = canManage ? await fetchAllDjangoUsers() : null;
  const candidateUsers = (djangoUsers ?? [])
    .map(mapDjangoUserToNexoShape)
    .filter((u) => visibleRoles === null || visibleRoles.includes(u.role))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Igual criterio que /api/users y /api/team: el email real solo se entrega
  // a quien puede gestionar usuarios — el resto ve una versión enmascarada.
  const canSeeRealEmails = canManageUsers(session.role);

  const serialized = {
    ...mapped,
    responsible: { ...mapped.responsible, email: maskEmailUnless(mapped.responsible.email, canSeeRealEmails) },
    participants: mapped.participants.map((p) => ({
      ...p,
      user: { ...p.user, email: maskEmailUnless(p.user.email, canSeeRealEmails) },
    })),
  };

  const serializedCandidates = candidateUsers.map((u) => ({ ...u, email: maskEmailUnless(u.email, canSeeRealEmails) }));

  return (
    <ProjectDetailView
      initialProject={serialized}
      // Bug encontrado en prueba integral en Chrome real (2026-08-31): esta
      // página ya resolvía correctamente el id numérico de Django arriba
      // (`djangoUserIdStr`, usado para `isResponsibleOrCreator`/`canDelete`)
      // pero seguía pasando el cuid de Postgres al cliente — rompía la
      // auto-detección de "soy participante" (línea 42 de
      // `ProjectDetailView.tsx`) y los permisos de registrar actividad por
      // fase (`ProjectActivitiesTab.tsx`), que comparan contra ids de
      // Django. Mismo criterio de degradación que el resto de la migración:
      // si Django no resolvió el id, cae al cuid en vez de romper.
      currentUserId={djangoUserIdStr ?? session.userId}
      currentUserRole={session.role}
      canManage={canManage}
      canDelete={canDelete}
      candidateUsers={serializedCandidates}
    />
  );
}
