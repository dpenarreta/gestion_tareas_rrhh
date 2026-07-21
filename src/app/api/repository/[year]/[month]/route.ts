import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";

type Ctx = { params: Promise<{ year: string; month: string }> };

const taskSelect = {
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
  targetTimeValidated: true,
  progress: true,
  color: true,
  corrected: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { year: yearStr, month: monthStr } = await ctx.params;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (Number.isNaN(year) || Number.isNaN(month)) {
    return NextResponse.json({ error: "Año o mes inválido" }, { status: 400 });
  }

  const closure = await prisma.monthClosure.findUnique({ where: { month_year: { month, year } } });
  if (!closure) {
    return NextResponse.json({ error: "Este mes no ha sido cerrado" }, { status: 404 });
  }

  const visibleRoles = getVisibleRoles(session.role);
  const visibleUsers = await prisma.user.findMany({
    where: { role: { in: visibleRoles } },
    select: { id: true },
  });
  const visibleIds = visibleUsers.map((u) => u.id);

  const archivedMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const tasks = await prisma.task.findMany({
    where: { archivedMonth: archivedMonthKey, assignedToId: { in: visibleIds } },
    select: taskSelect,
    orderBy: [{ assignedTo: { name: "asc" } }, { title: "asc" }],
  });

  return NextResponse.json(tasks);
}
