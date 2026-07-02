import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleIdeaAuthorIds } from "@/lib/ideas";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const idea = await prisma.improvementIdea.findUnique({ where: { id }, select: { authorId: true } });
  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });

  const visibleIds = await getVisibleIdeaAuthorIds(session);
  if (!visibleIds.includes(idea.authorId)) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }

  const history = await prisma.ideaStatusHistory.findMany({
    where: { ideaId: id },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      comment: true,
      createdAt: true,
      changer: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(history);
}
