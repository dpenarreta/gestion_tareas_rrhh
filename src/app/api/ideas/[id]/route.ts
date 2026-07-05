import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleIdeaAuthorIds } from "@/lib/ideas";
import { canReviewIdeas } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

function ideaDetailSelect(userId: string) {
  return {
    id: true,
    title: true,
    description: true,
    impact: true,
    status: true,
    progress: true,
    attachmentUrl: true,
    attachmentData: true,
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, name: true, role: true } },
    history: {
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        comment: true,
        createdAt: true,
        changer: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "asc" as const },
    },
    _count: { select: { votes: true } },
    votes: { where: { userId }, select: { id: true } },
  } as const;
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const idea = await prisma.improvementIdea.findUnique({ where: { id }, select: ideaDetailSelect(session.userId) });
  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });

  const visibleIds = await getVisibleIdeaAuthorIds(session);
  if (!visibleIds.includes(idea.author.id)) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }

  const { _count, votes, ...rest } = idea;
  const result = { ...rest, voteCount: _count.votes, votedByMe: votes.length > 0 };

  if (idea.status !== "PROPUESTA") {
    return NextResponse.json({ ...result, attachmentUrl: null, attachmentData: null });
  }

  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canReviewIdeas(session.role)) {
    return NextResponse.json({ error: "Sin permisos para actualizar el progreso" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const progress = body?.progress;
  if (typeof progress !== "number" || !Number.isInteger(progress) || progress < 0 || progress > 100) {
    return NextResponse.json({ error: "Progreso inválido (debe ser un entero entre 0 y 100)" }, { status: 400 });
  }

  const idea = await prisma.improvementIdea.findUnique({ where: { id }, select: { id: true, authorId: true } });
  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });

  const visibleIds = await getVisibleIdeaAuthorIds(session);
  if (!visibleIds.includes(idea.authorId)) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }

  const updated = await prisma.improvementIdea.update({
    where: { id },
    data: { progress },
    select: ideaDetailSelect(session.userId),
  });
  const { _count, votes, ...rest } = updated;
  return NextResponse.json({ ...rest, voteCount: _count.votes, votedByMe: votes.length > 0 });
}
