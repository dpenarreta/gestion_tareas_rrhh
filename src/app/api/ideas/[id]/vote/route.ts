import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleIdeaAuthorIds } from "@/lib/ideas";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const idea = await prisma.improvementIdea.findUnique({ where: { id }, select: { id: true, authorId: true } });
  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });

  const visibleIds = await getVisibleIdeaAuthorIds(session);
  if (!visibleIds.includes(idea.authorId)) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }

  const existing = await prisma.ideaVote.findUnique({
    where: { ideaId_userId: { ideaId: id, userId: session.userId } },
  });

  if (existing) {
    await prisma.ideaVote.delete({ where: { id: existing.id } });
  } else {
    await prisma.ideaVote.create({ data: { ideaId: id, userId: session.userId } });
  }

  const voteCount = await prisma.ideaVote.count({ where: { ideaId: id } });

  return NextResponse.json({ voteCount, votedByMe: !existing });
}
