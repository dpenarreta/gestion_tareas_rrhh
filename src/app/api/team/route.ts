import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getSubordinateRoles, canViewTeam } from "@/lib/roles";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canViewTeam(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const subordinateRoles = getSubordinateRoles(session.role);

  const users = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      assignedTasks: { select: { status: true } },
    },
    orderBy: { name: "asc" },
  });

  const members = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    tasks: {
      total: u.assignedTasks.length,
      completed: u.assignedTasks.filter((t) => t.status === "COMPLETADA").length,
      inProgress: u.assignedTasks.filter((t) => t.status === "EN_PROGRESO").length,
      pending: u.assignedTasks.filter((t) => t.status === "PENDIENTE").length,
    },
  }));

  return NextResponse.json(members);
}
