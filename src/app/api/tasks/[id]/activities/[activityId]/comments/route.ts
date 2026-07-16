import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string; activityId: string }> };

const commentSelect = {
  id: true,
  text: true,
  author: { select: { id: true, name: true, role: true } },
  createdAt: true,
} as const;

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id: taskId, activityId } = await ctx.params;
    const activity = await prisma.taskActivity.findUnique({ where: { id: activityId } });
    if (!activity || activity.taskId !== taskId) {
      return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    }

    const comments = await prisma.activityComment.findMany({
      where: { activityId },
      select: commentSelect,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(comments);
  } catch (err) {
    console.error("GET /activities/[activityId]/comments error:", err);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id: taskId, activityId } = await ctx.params;

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

    const activity = await prisma.taskActivity.findUnique({ where: { id: activityId } });
    if (!activity || activity.taskId !== taskId) {
      return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    const comment = await prisma.activityComment.create({
      data: { text: text.trim(), authorId: session.userId, activityId },
      select: commentSelect,
    });

    // Notificación bidireccional: a diferencia de los comentarios de tarea (que solo
    // notifican hacia arriba en la jerarquía), aquí se notifica a TODOS los que ya
    // participaron en el hilo de esta actividad (autor de la actividad + cualquiera que
    // haya comentado antes), sin importar su nivel jerárquico — excepto a quien acaba de
    // comentar.
    const priorCommenters = await prisma.activityComment.findMany({
      where: { activityId, NOT: { id: comment.id } },
      select: { authorId: true },
      distinct: ["authorId"],
    });
    const participantIds = new Set<string>([activity.authorId, ...priorCommenters.map((c) => c.authorId)]);
    participantIds.delete(session.userId);

    if (participantIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(participantIds).map((userId) => ({
          userId,
          message: `${session.name} (${ROLE_LABEL[session.role]}) comentó en una actividad de "${task.title}"`,
          taskId,
          taskTitle: task.title,
        })),
      });
    }

    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    console.error("POST /activities/[activityId]/comments error:", err);
    return NextResponse.json({ error: "Error interno al comentar la actividad" }, { status: 500 });
  }
}
