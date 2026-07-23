import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canCreateProject, canManageUsers, getSubordinateRoles, ROLE_LEVEL } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import ProjectsModule from "@/components/projects/ProjectsModule";

const projectListSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  priority: true,
  area: true,
  tags: true,
  startDate: true,
  targetDate: true,
  targetTimeHours: true,
  realHours: true,
  completedAt: true,
  responsible: { select: { id: true, name: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { participants: true, phases: true, comments: true, documents: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isLeadership = ROLE_LEVEL[session.role] >= 3;

  const [projects, candidateUsers] = await Promise.all([
    prisma.project.findMany({
      where: {
        deletedAt: null,
        ...(isLeadership
          ? {}
          : {
              OR: [
                { responsibleId: session.userId },
                { createdById: session.userId },
                { participants: { some: { userId: session.userId } } },
              ],
            }),
      },
      select: projectListSelect,
      orderBy: { createdAt: "desc" },
    }),
    canManageUsers(session.role)
      ? prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } })
      : prisma.user.findMany({
          where: { role: { in: getSubordinateRoles(session.role) } },
          select: { id: true, name: true, email: true, role: true },
          orderBy: { name: "asc" },
        }),
  ]);

  const serialized = projects.map((p) => ({
    ...p,
    startDate: p.startDate.toISOString(),
    targetDate: p.targetDate.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const canSeeRealEmails = canManageUsers(session.role);
  const serializedCandidates = candidateUsers.map((u) => ({ ...u, email: maskEmailUnless(u.email, canSeeRealEmails) }));

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
