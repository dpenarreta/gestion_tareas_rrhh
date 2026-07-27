import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject } from "@/lib/projectAccess";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Simulador — escenario "agregar participantes" (Bloque 8), a nivel de
 * proyecto. No encaja en `/api/analytics/simulate/[userId]` (contrato de
 * usuario individual) — ruta nueva. Nunca persiste nada; solo recalcula el
 * promedio de horas restantes por participante.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { projectId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { additionalParticipants } = (body ?? {}) as { additionalParticipants?: number };
  if (typeof additionalParticipants !== "number" || additionalParticipants <= 0 || additionalParticipants > 20) {
    return NextResponse.json({ error: "Escenario inválido" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { responsibleId: true, createdById: true, targetTimeHours: true, realHours: true, participants: { select: { userId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  const participantUserIds = project.participants.map((p) => p.userId);
  if (!canViewProject(session, project, participantUserIds)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const remainingHours = Math.max(0, project.targetTimeHours - project.realHours);
  const currentParticipants = Math.max(1, participantUserIds.length);
  const newParticipants = currentParticipants + additionalParticipants;

  return NextResponse.json({
    before: { participants: currentParticipants, avgRemainingHoursPerParticipant: Math.round((remainingHours / currentParticipants) * 100) / 100 },
    after: { participants: newParticipants, avgRemainingHoursPerParticipant: Math.round((remainingHours / newParticipants) * 100) / 100 },
    scenario: { type: "add_participants", projectId, additionalParticipants },
  });
}
