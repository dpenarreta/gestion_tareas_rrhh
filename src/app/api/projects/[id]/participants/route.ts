import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageParticipants } from "@/lib/projectAccess";
import { canManageUsers } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { logProjectHistory } from "@/lib/projectHistory";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, responsibleId: true, createdById: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canManageParticipants(session, project)) {
    return NextResponse.json({ error: "No tienes permiso para agregar participantes" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { userId } = body as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "Falta el usuario a agregar" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Usuario inválido" }, { status: 400 });
  }

  const existing = await prisma.projectParticipant.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Este usuario ya es participante del proyecto" }, { status: 409 });
  }

  const participant = await prisma.projectParticipant.create({
    data: { projectId, userId, addedById: session.userId },
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, role: true } },
      addedAt: true,
      addedBy: { select: { id: true, name: true } },
    },
  });

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "PARTICIPANTE_AGREGADO",
    description: `${session.name} agregó a ${user.name} como participante de "${project.name}"`,
    newValue: { userId },
  });

  const canSeeRealEmails = canManageUsers(session.role);
  return NextResponse.json(
    { ...participant, user: { ...participant.user, email: maskEmailUnless(participant.user.email, canSeeRealEmails) } },
    { status: 201 }
  );
}
