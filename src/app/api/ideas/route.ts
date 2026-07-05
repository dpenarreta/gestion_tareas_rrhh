import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleIdeaAuthorIds } from "@/lib/ideas";
import { saveIdeaAttachment, AttachmentError } from "@/lib/storage";
import type { IdeaImpact } from "@/generated/prisma/client";

function ideaListSelect(userId: string) {
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
    history: {
      where: { toStatus: "RECHAZADA" as const },
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { comment: true },
    },
    _count: { select: { votes: true } },
    votes: { where: { userId }, select: { id: true } },
  } as const;
}

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

const VALID_IMPACTS: IdeaImpact[] = ["ALTO", "MEDIO", "BAJO"];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const visibleIds = await getVisibleIdeaAuthorIds(session);
  const ideas = await prisma.improvementIdea.findMany({
    where: { authorId: { in: visibleIds } },
    select: ideaListSelect(session.userId),
    orderBy: { createdAt: "desc" },
  });

  const result = ideas.map(({ history, _count, votes, ...rest }) => ({
    ...rest,
    latestRejectionComment: history[0]?.comment ?? null,
    voteCount: _count.votes,
    votedByMe: votes.length > 0,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const impact = String(formData.get("impact") ?? "") as IdeaImpact;
  const file = formData.get("file");

  if (!title || !description || !VALID_IMPACTS.includes(impact)) {
    return NextResponse.json({ error: "Faltan campos requeridos o son inválidos" }, { status: 400 });
  }

  let attachmentUrl: string | null = null;
  let attachmentData: string | null = null;
  if (file instanceof File && file.size > 0) {
    try {
      const saved = await saveIdeaAttachment(file);
      attachmentUrl = saved.fileName;
      attachmentData = saved.attachmentData;
    } catch (err) {
      if (err instanceof AttachmentError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const created = await prisma.improvementIdea.create({
    data: { title, description, impact, authorId: session.userId, attachmentUrl, attachmentData },
    select: ideaSelect(session.userId),
  });
  const { _count, votes, ...idea } = created;
  const ideaResult = { ...idea, voteCount: _count.votes, votedByMe: votes.length > 0 };

  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"] } },
    select: { id: true },
  });
  if (reviewers.length > 0) {
    await prisma.notification.createMany({
      data: reviewers.map((r) => ({
        userId: r.id,
        message: `${session.name} propuso una nueva idea: "${title}"`,
        taskTitle: title,
      })),
    });
  }

  return NextResponse.json(ideaResult, { status: 201 });
}
