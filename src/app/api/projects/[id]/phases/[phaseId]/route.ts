import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManagePhases } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";
import { getPhaseStats } from "@/lib/projectPhaseStats";
import type { TaskStatus } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string; phaseId: string }> };

const phaseSelect = {
  id: true,
  name: true,
  status: true,
  responsible: { select: { id: true, name: true } },
  startDate: true,
  targetDate: true,
  progress: true,
  notes: true,
  targetTimeHours: true,
  order: true,
} as const;

async function loadPhase(projectId: string, phaseId: string) {
  const phase = await prisma.projectPhase.findUnique({ where: { id: phaseId } });
  if (!phase || phase.projectId !== projectId) return null;
  return phase;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, phaseId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, responsibleId: true, createdById: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canManagePhases(session, project)) {
    return NextResponse.json({ error: "No tienes permiso para modificar fases" }, { status: 403 });
  }

  const current = await loadPhase(projectId, phaseId);
  if (!current) {
    return NextResponse.json({ error: "Fase no encontrada" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { name, status, responsibleId, startDate, targetDate, targetTimeHours, notes, progress } = body as {
    name?: string;
    status?: TaskStatus;
    responsibleId?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    targetTimeHours?: number | null;
    notes?: string | null;
    progress?: number;
  };

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (responsibleId !== undefined) data.responsibleId = responsibleId || null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (targetDate !== undefined) data.targetDate = targetDate ? new Date(targetDate) : null;
  if (targetTimeHours !== undefined) data.targetTimeHours = targetTimeHours != null ? parseFloat(String(targetTimeHours)) : null;
  if (notes !== undefined) data.notes = notes?.trim() || null;
  if (progress !== undefined) {
    const p = Math.trunc(Number(progress));
    if (Number.isNaN(p) || p < 0 || p > 100) {
      return NextResponse.json({ error: "El progreso debe estar entre 0 y 100" }, { status: 400 });
    }
    data.progress = p;
  }
  if (status !== undefined) data.status = status;

  const updated = await prisma.projectPhase.update({ where: { id: phaseId }, data, select: phaseSelect });

  // Sprint 2.1 §1: el historial solo registra eventos relevantes de negocio —
  // un cambio de ESTADO de fase lo es; progreso/notas/fechas/responsable son
  // ediciones intermedias que ya no se auditan una por una (antes se logueaba
  // "actualizó la fase" en CADA patch, incluido cada tick del slider de progreso).
  if (status !== undefined && status !== current.status) {
    await logProjectHistory({
      projectId,
      actorId: session.userId,
      event: "FASE_ACTUALIZADA",
      description: `${session.name} cambió el estado de la fase "${current.name}" de ${current.status} a ${status}`,
      previousValue: { status: current.status },
      newValue: { status },
    });
  }

  const stats = await getPhaseStats(projectId, [{ id: phaseId }]);
  const stat = stats.get(phaseId);

  return NextResponse.json({ ...updated, registeredMinutes: stat?.registeredMinutes ?? 0, participants: stat?.participants ?? [] });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, phaseId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, responsibleId: true, createdById: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canManagePhases(session, project)) {
    return NextResponse.json({ error: "No tienes permiso para eliminar fases" }, { status: 403 });
  }

  const current = await loadPhase(projectId, phaseId);
  if (!current) {
    return NextResponse.json({ error: "Fase no encontrada" }, { status: 404 });
  }

  await prisma.projectPhase.delete({ where: { id: phaseId } });

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "FASE_ELIMINADA",
    description: `${session.name} eliminó la fase "${current.name}" de "${project.name}"`,
    previousValue: { phaseId, name: current.name },
  });

  return NextResponse.json({ success: true });
}
