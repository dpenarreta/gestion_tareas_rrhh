import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageParticipants } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";

type Ctx = { params: Promise<{ id: string; participantId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, participantId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, responsibleId: true, createdById: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canManageParticipants(session, project)) {
    return NextResponse.json({ error: "No tienes permiso para quitar participantes" }, { status: 403 });
  }

  const participant = await prisma.projectParticipant.findUnique({
    where: { id: participantId },
    select: { id: true, projectId: true, userId: true, user: { select: { name: true } } },
  });
  if (!participant || participant.projectId !== projectId) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }
  if (participant.userId === project.responsibleId) {
    return NextResponse.json(
      { error: "No puedes quitar al responsable principal — cambia el responsable primero" },
      { status: 409 }
    );
  }

  await prisma.projectParticipant.delete({ where: { id: participantId } });

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "PARTICIPANTE_ELIMINADO",
    description: `${session.name} quitó a ${participant.user.name} del proyecto "${project.name}"`,
    previousValue: { userId: participant.userId },
  });

  return NextResponse.json({ success: true });
}
