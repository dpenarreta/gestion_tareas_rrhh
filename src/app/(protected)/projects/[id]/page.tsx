import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canViewProject, isProjectManager, isProjectCreator } from "@/lib/projectAccess";
import { canManageUsers, getVisibleRoles } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { getPhaseStats, getLastActivity } from "@/lib/projectPhaseStats";
import ProjectDetailView from "@/components/projects/ProjectDetailView";

const projectDetailSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  priority: true,
  area: true,
  tags: true,
  observations: true,
  startDate: true,
  targetDate: true,
  targetTimeHours: true,
  realHours: true,
  completedAt: true,
  responsibleId: true,
  responsible: { select: { id: true, name: true, email: true, role: true } },
  createdById: true,
  createdBy: { select: { id: true, name: true } },
  participants: {
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, role: true } },
      addedAt: true,
      addedBy: { select: { id: true, name: true } },
    },
    orderBy: { addedAt: "asc" as const },
  },
  phases: {
    select: {
      id: true,
      name: true,
      status: true,
      responsible: { select: { id: true, name: true } },
      startDate: true,
      targetDate: true,
      progress: true,
      notes: true,
      targetTimeHours: true,
      order: true,
    },
    orderBy: { order: "asc" as const },
  },
  _count: { select: { comments: true, documents: true, activities: true } },
  createdAt: true,
  updatedAt: true,
};

type Ctx = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: projectDetailSelect });
  if (!project) notFound();

  const participantUserIds = project.participants.map((p) => p.userId);
  if (!canViewProject(session, project, participantUserIds)) notFound();

  const canManage = isProjectManager(session, project);
  const canDelete = isProjectCreator(session, project);

  const [phaseStats, lastActivity] = await Promise.all([
    getPhaseStats(id, project.phases),
    getLastActivity(id),
  ]);

  // Solo se envía el directorio de usuarios al cliente si puede gestionar
  // participantes — y acotado a su jerarquía visible salvo que sea liderazgo
  // (nivel >= 3), igual que en el resto de la app (evita filtrar nombres/roles
  // de toda la organización a quien solo es responsable de un proyecto puntual).
  const candidateUsers = canManage
    ? await prisma.user.findMany({
        where: canManageUsers(session.role) ? undefined : { role: { in: getVisibleRoles(session.role) } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Igual criterio que /api/users y /api/team: el email real solo se entrega
  // a quien puede gestionar usuarios — el resto ve una versión enmascarada.
  const canSeeRealEmails = canManageUsers(session.role);

  const serialized = {
    ...project,
    responsible: { ...project.responsible, email: maskEmailUnless(project.responsible.email, canSeeRealEmails) },
    startDate: project.startDate.toISOString(),
    targetDate: project.targetDate.toISOString(),
    completedAt: project.completedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    phases: project.phases.map((ph) => ({
      ...ph,
      startDate: ph.startDate?.toISOString() ?? null,
      targetDate: ph.targetDate?.toISOString() ?? null,
      registeredMinutes: phaseStats.get(ph.id)?.registeredMinutes ?? 0,
      participants: phaseStats.get(ph.id)?.participants ?? [],
    })),
    participants: project.participants.map((p) => ({
      ...p,
      user: { ...p.user, email: maskEmailUnless(p.user.email, canSeeRealEmails) },
      addedAt: p.addedAt.toISOString(),
    })),
    lastActivity: lastActivity ? { authorName: lastActivity.authorName, createdAt: lastActivity.createdAt.toISOString() } : null,
  };

  const serializedCandidates = candidateUsers.map((u) => ({ ...u, email: maskEmailUnless(u.email, canSeeRealEmails) }));

  return (
    <ProjectDetailView
      initialProject={serialized}
      currentUserId={session.userId}
      currentUserRole={session.role}
      canManage={canManage}
      canDelete={canDelete}
      candidateUsers={serializedCandidates}
    />
  );
}
