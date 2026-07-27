import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { computeCapacityForecast, classifyCapacity } from "@/lib/capacityForecast";
import { computeHealthScore, capacityToScore, weightedPoints } from "@/lib/analytics";
import { getOfficialTargetTime } from "@/lib/targetTime";

type Ctx = { params: Promise<{ userId: string }> };

type Snapshot = {
  capacidadDisponiblePct: number;
  capacidadDisponibleHoras: number;
  healthScore: number;
  healthClassification: string;
};

/**
 * Simulador — escenario "modificar tiempo objetivo" (Bloque 8), a nivel de
 * tarea. Ruta NUEVA y separada de `/api/analytics/simulate/[userId]`
 * (protegida esta sesión, no se toca) — reutiliza las MISMAS funciones puras
 * del motor (computeHealthScore/computeCapacityForecast/classifyCapacity/
 * capacityToScore/weightedPoints, todas ya exportadas) en vez de
 * reimplementarlas. Nunca persiste nada.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { userId } = await ctx.params;

  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  const isSelf = session.userId === userId;
  if (!isSelf && !getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { taskId, newTargetTimeHours } = (body ?? {}) as { taskId?: string; newTargetTimeHours?: number };
  if (!taskId || typeof newTargetTimeHours !== "number" || newTargetTimeHours < 0 || newTargetTimeHours > 1000) {
    return NextResponse.json({ error: "Escenario inválido" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assignedToId: true, status: true, estimatedHours: true, targetTimeValidated: true, realHours: true },
  });
  if (!task || task.assignedToId !== userId) {
    return NextResponse.json({ error: "Tarea no encontrada para este usuario" }, { status: 404 });
  }
  if (task.status !== "PENDIENTE" && task.status !== "EN_PROGRESO") {
    return NextResponse.json({ error: "Solo se puede simular sobre tareas Pendientes o En Progreso" }, { status: 400 });
  }

  const now = new Date();
  const [capacity, healthScore] = await Promise.all([computeCapacityForecast(userId, now), computeHealthScore(userId, now)]);

  // Misma regla que computeTeamCapacityForecast: una tarea En Progreso aporta
  // (tiempo objetivo - horas ya reales) a comprometidoFuturo; Pendiente aporta
  // el tiempo objetivo completo.
  const currentOfficial = getOfficialTargetTime(task);
  const currentContribution = task.status === "EN_PROGRESO" ? Math.max(0, currentOfficial - task.realHours) : currentOfficial;
  const newContribution = task.status === "EN_PROGRESO" ? Math.max(0, newTargetTimeHours - task.realHours) : newTargetTimeHours;
  const delta = newContribution - currentContribution;

  const newComprometidoFuturo = Math.max(0, Math.round((capacity.comprometidoFuturo + delta) * 100) / 100);
  const newDisponible = Math.round((capacity.baseFuturaTotal - newComprometidoFuturo) * 100) / 100;
  const newDisponiblePct = capacity.baseFuturaTotal > 0 ? Math.round((newDisponible / capacity.baseFuturaTotal) * 100) : 0;
  const cls = classifyCapacity(newDisponible, capacity.baseFuturaTotal, newDisponiblePct);
  const newCapacityScore = capacityToScore(cls.estado, newDisponiblePct);

  const capacityFactor = healthScore.factors.find((f) => f.name === "Capacidad futura")!;
  const otherPoints = healthScore.factors.filter((f) => f.name !== "Capacidad futura").reduce((s, f) => s + f.points, 0);
  const newScore = Math.round((otherPoints + weightedPoints(newCapacityScore, capacityFactor.weight)) * 100) / 100;
  const newClassification = newScore >= 90 ? "Excelente" : newScore >= 75 ? "Bueno" : newScore >= 60 ? "Riesgo" : "Crítico";

  const before: Snapshot = {
    capacidadDisponiblePct: capacity.disponiblePct,
    capacidadDisponibleHoras: capacity.disponible,
    healthScore: healthScore.score,
    healthClassification: healthScore.classification,
  };
  const after: Snapshot = {
    capacidadDisponiblePct: newDisponiblePct,
    capacidadDisponibleHoras: newDisponible,
    healthScore: newScore,
    healthClassification: newClassification,
  };

  return NextResponse.json({
    before,
    after,
    diff: { healthScore: Math.round((after.healthScore - before.healthScore) * 100) / 100 },
    scenario: { type: "adjust_target_time", taskId, newTargetTimeHours },
  });
}
