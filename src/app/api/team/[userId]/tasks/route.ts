import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getSubordinateRoles, canViewTeam } from "@/lib/roles";

type Ctx = { params: Promise<{ userId: string }> };

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
  progress: true,
  color: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canViewTeam(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { userId } = await ctx.params;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const subordinateRoles = getSubordinateRoles(session.role);
  if (!subordinateRoles.includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos para ver este usuario" }, { status: 403 });
  }

  const tasks = await prisma.task.findMany({
    where: { assignedToId: userId, archivedMonth: null },
    select: taskSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tasks);
}
