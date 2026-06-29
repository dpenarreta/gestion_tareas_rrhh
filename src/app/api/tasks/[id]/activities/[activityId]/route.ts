import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; activityId: string }> };

async function recalcRealHours(taskId: string) {
  const activities = await prisma.taskActivity.findMany({
    where: { taskId },
    select: { duration: true },
  });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.task.update({
    where: { id: taskId },
    data: { realHours: totalMins / 60 },
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id: taskId, activityId } = await ctx.params;

    const activity = await prisma.taskActivity.findUnique({
      where: { id: activityId },
    });

    if (!activity || activity.taskId !== taskId) {
      return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    }

    if (activity.authorId !== session.userId) {
      return NextResponse.json({ error: "Sin permiso para eliminar" }, { status: 403 });
    }

    await prisma.taskActivity.delete({ where: { id: activityId } });
    await recalcRealHours(taskId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /activities/[activityId] error:", err);
    return NextResponse.json({ error: "Error interno al eliminar actividad" }, { status: 500 });
  }
}
