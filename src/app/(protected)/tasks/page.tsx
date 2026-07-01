import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getVisibleRoles } from "@/lib/roles";
import TasksModule from "@/components/tasks/TasksModule";
import type { ViewType } from "@/components/tasks/types";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const visibleRoles = getVisibleRoles(session.role);

  const [user, tasks, assignableUsers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { viewPreferences: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: session.userId },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        status: true,
        priority: true,
        frequency: true,
        startDate: true,
        endDate: true,
        estimatedHours: true,
        realHours: true,
        progress: true,
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { role: { in: visibleRoles } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const serializedTasks = tasks.map((t) => ({
    ...t,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  const VALID_VIEWS: ViewType[] = ["KANBAN", "TABLA", "GANTT"];
  const taskViews = (user?.viewPreferences ?? ["KANBAN", "TABLA"]).filter((v) =>
    VALID_VIEWS.includes(v as ViewType)
  ) as ViewType[];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Tareas</h1>
      <TasksModule
        initialTasks={serializedTasks}
        initialViews={taskViews.length > 0 ? taskViews : ["KANBAN", "TABLA"]}
        initialUsers={assignableUsers}
        currentUserId={session.userId}
      />
    </div>
  );
}
