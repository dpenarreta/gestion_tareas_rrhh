import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManagePhases } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";
import type { TaskStatus } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

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

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, responsibleId: true, createdById: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canManagePhases(session, project)) {
    return NextResponse.json({ error: "No tienes permiso para agregar fases" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { name, status, responsibleId, startDate, targetDate, targetTimeHours, notes } = body as {
    name?: string;
    status?: TaskStatus;
    responsibleId?: string;
    startDate?: string;
    targetDate?: string;
    targetTimeHours?: number;
    notes?: string;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "El nombre de la fase es requerido" }, { status: 400 });
  }

  const lastOrder = await prisma.projectPhase.count({ where: { projectId } });

  const phase = await prisma.projectPhase.create({
    data: {
      projectId,
      name: name.trim(),
      status: status ?? "PENDIENTE",
      responsibleId: responsibleId || null,
      startDate: startDate ? new Date(startDate) : null,
      targetDate: targetDate ? new Date(targetDate) : null,
      targetTimeHours: targetTimeHours != null ? parseFloat(String(targetTimeHours)) : null,
      notes: notes?.trim() || null,
      order: lastOrder,
    },
    select: phaseSelect,
  });

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "FASE_AGREGADA",
    description: `${session.name} agregó la fase "${phase.name}" a "${project.name}"`,
    newValue: { phaseId: phase.id, name: phase.name },
  });

  return NextResponse.json(phase, { status: 201 });
}
