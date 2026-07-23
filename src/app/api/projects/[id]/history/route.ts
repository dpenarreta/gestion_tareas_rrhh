import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject } from "@/lib/projectAccess";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      responsibleId: true,
      createdById: true,
      participants: { select: { userId: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canViewProject(session, project, project.participants.map((p) => p.userId))) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }

  const history = await prisma.projectHistory.findMany({
    where: { projectId },
    select: {
      id: true,
      event: true,
      description: true,
      previousValue: true,
      newValue: true,
      actor: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(history);
}
