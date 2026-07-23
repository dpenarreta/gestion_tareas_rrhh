import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject, isProjectParticipant } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";

type Ctx = { params: Promise<{ id: string }> };

async function loadProjectForAccess(id: string) {
  return prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      responsibleId: true,
      createdById: true,
      participants: { select: { userId: true } },
    },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canViewProject(session, project, project.participants.map((p) => p.userId))) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }

  const comments = await prisma.projectComment.findMany({
    where: { projectId },
    select: { id: true, text: true, author: { select: { id: true, name: true, role: true } }, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(comments);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const participantIds = project.participants.map((p) => p.userId);
  if (!isProjectParticipant(session, project, participantIds)) {
    return NextResponse.json({ error: "Solo los participantes del proyecto pueden comentar" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { text } = body as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "El comentario no puede estar vacío" }, { status: 400 });
  }

  const comment = await prisma.projectComment.create({
    data: { projectId, authorId: session.userId, text: text.trim() },
    select: { id: true, text: true, author: { select: { id: true, name: true, role: true } }, createdAt: true },
  });

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "COMENTARIO_AGREGADO",
    description: `${session.name} comentó en "${project.name}"`,
  });

  return NextResponse.json(comment, { status: 201 });
}
