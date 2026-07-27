import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { cached } from "@/lib/analytics";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { computeCumplimientoProjection, computeSobrecargaProbability, computeOperationalStability, computeTaskDelayPrediction } from "@/lib/predictionEngine";

type Ctx = { params: Promise<{ userId: string }> };

// Máximo de tareas abiertas evaluadas por predicción de retraso individual —
// cada llamada a computeTaskDelayPrediction recalcula capacidad/consistencia
// del MISMO usuario (redundante entre tareas), acotado para no degradar el
// tiempo de respuesta cuando alguien tiene muchas tareas abiertas a la vez.
const MAX_TASK_DELAY_PREDICTIONS = 10;

async function computeBundle(userId: string, now: Date) {
  const [cumplimiento, sobrecarga, estabilidad, openTasks] = await Promise.all([
    computeCumplimientoProjection(userId, now),
    computeSobrecargaProbability(userId, now),
    computeOperationalStability(userId, now),
    prisma.task.findMany({
      where: { assignedToId: userId, status: { not: "COMPLETADA" }, archivedMonth: null },
      select: { id: true, title: true, endDate: true },
      orderBy: { endDate: "asc" },
      take: MAX_TASK_DELAY_PREDICTIONS,
    }),
  ]);
  const taskDelays = await Promise.all(
    openTasks.map(async (t) => ({ taskId: t.id, title: t.title, prediction: await computeTaskDelayPrediction(t.id, now) }))
  );
  return { cumplimiento, sobrecarga, estabilidad, taskDelays };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { userId } = await ctx.params;

  if (session.userId !== userId) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target || !getVisibleRoles(session.role).includes(target.role)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
  }

  const now = new Date();
  const config = await getEffectiveAnalyticsConfig(now);
  const { value, fromCache } = await cached(`prediction-engine:${userId}`, config.cacheTtlMinutes, () => computeBundle(userId, now));
  return NextResponse.json({ ...value, fromCache });
}
