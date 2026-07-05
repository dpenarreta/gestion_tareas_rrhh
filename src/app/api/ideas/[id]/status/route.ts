import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canReviewIdeas } from "@/lib/roles";
import { nextIdeaStatus, prevIdeaStatus, canReject, IDEA_STATUS_LABELS } from "@/lib/ideas";
import type { IdeaStatus } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

type Action = "ADVANCE" | "RETREAT" | "REJECT" | "REOPEN";
const VALID_ACTIONS: Action[] = ["ADVANCE", "RETREAT", "REJECT", "REOPEN"];

function ideaSelect(userId: string) {
  return {
    id: true,
    title: true,
    description: true,
    impact: true,
    status: true,
    progress: true,
    attachmentUrl: true,
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, name: true, role: true } },
    _count: { select: { votes: true } },
    votes: { where: { userId }, select: { id: true } },
  } as const;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canReviewIdeas(session.role)) {
    return NextResponse.json({ error: "Sin permisos para mover ideas" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const idea = await prisma.improvementIdea.findUnique({ where: { id } });
  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const action = body?.action as Action | undefined;
  const comment: string | null = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;

  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const fromStatus = idea.status;
  let toStatus: IdeaStatus;

  if (action === "ADVANCE") {
    const next = nextIdeaStatus(fromStatus);
    if (!next) return NextResponse.json({ error: "No se puede avanzar desde esta etapa" }, { status: 400 });
    toStatus = next;
  } else if (action === "RETREAT") {
    const prev = prevIdeaStatus(fromStatus);
    if (!prev) return NextResponse.json({ error: "No se puede retroceder desde esta etapa" }, { status: 400 });
    toStatus = prev;
  } else if (action === "REJECT") {
    if (!canReject(fromStatus)) {
      return NextResponse.json({ error: "No se puede rechazar esta idea desde su etapa actual" }, { status: 400 });
    }
    if (!comment) {
      return NextResponse.json({ error: "El motivo del rechazo es obligatorio" }, { status: 400 });
    }
    toStatus = "RECHAZADA";
  } else {
    if (fromStatus !== "RECHAZADA") {
      return NextResponse.json({ error: "Sólo se puede reabrir una idea rechazada" }, { status: 400 });
    }
    toStatus = "EN_REVISION";
  }

  let message: string;
  if (action === "REJECT") {
    message = `Tu idea "${idea.title}" fue rechazada: ${comment}`;
  } else if (toStatus === "IMPLEMENTADA") {
    message = `🎉 ¡Felicidades! Tu idea "${idea.title}" fue implementada`;
  } else {
    message = `Tu idea "${idea.title}" pasó a ${IDEA_STATUS_LABELS[toStatus]}`;
  }

  await prisma.$transaction(async (tx) => {
    await tx.ideaStatusHistory.create({
      data: { ideaId: id, fromStatus, toStatus, changedBy: session.userId, comment },
    });
    await tx.improvementIdea.update({
      where: { id },
      data: {
        status: toStatus,
        ...(fromStatus === "PROPUESTA" ? { attachmentUrl: null, attachmentData: null } : {}),
      },
    });

    if (idea.authorId !== session.userId) {
      await tx.notification.create({
        data: { userId: idea.authorId, message, taskTitle: idea.title },
      });
    }

    if (toStatus === "IMPLEMENTADA") {
      const author = await tx.user.findUnique({ where: { id: idea.authorId }, select: { badges: true } });
      const badges = author?.badges ?? [];
      if (!badges.includes("innovador")) {
        await tx.user.update({ where: { id: idea.authorId }, data: { badges: { push: "innovador" } } });
      }
    }
  });

  const updated = await prisma.improvementIdea.findUnique({ where: { id }, select: ideaSelect(session.userId) });
  if (!updated) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  const { _count, votes, ...rest } = updated;
  return NextResponse.json({ ...rest, voteCount: _count.votes, votedByMe: votes.length > 0 });
}
