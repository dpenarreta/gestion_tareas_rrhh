import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getNotificationTargets } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const comments = await prisma.comment.findMany({
    where: { taskId: id },
    include: { author: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: "asc" },
  });

  await prisma.taskCommentView.upsert({
    where: { taskId_userId: { taskId: id, userId: session.userId } },
    update: { viewedAt: new Date() },
    create: { taskId: id, userId: session.userId },
  });

  return NextResponse.json(comments);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId } = await ctx.params;
  const { text } = await request.json();

  if (!text?.trim()) {
    return NextResponse.json({ error: "El comentario no puede estar vacío" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const comment = await prisma.comment.create({
    data: { text: text.trim(), authorId: session.userId, taskId },
    include: { author: { select: { id: true, name: true, role: true } } },
  });

  const targetRoles = getNotificationTargets(session.role);
  if (targetRoles.length > 0) {
    const targetUsers = await prisma.user.findMany({
      where: { role: { in: targetRoles } },
      select: { id: true },
    });

    if (targetUsers.length > 0) {
      const preview = text.trim().slice(0, 60) + (text.trim().length > 60 ? "…" : "");
      await prisma.notification.createMany({
        data: targetUsers.map((u) => ({
          userId: u.id,
          message: `${session.name} comentó en "${task.title}": ${preview}`,
          taskId,
          taskTitle: task.title,
        })),
      });
    }
  }

  return NextResponse.json(comment, { status: 201 });
}
