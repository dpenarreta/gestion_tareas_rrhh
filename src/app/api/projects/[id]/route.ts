import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject, isProjectManager, isProjectCreator } from "@/lib/projectAccess";
import { canManageUsers } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { logProjectHistory } from "@/lib/projectHistory";
import * as recoveryCenter from "@/lib/recoveryCenter";
import { getPhaseStats, getLastActivity } from "@/lib/projectPhaseStats";
import type { ProjectStatus, TaskPriority, Prisma } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const projectDetailSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  priority: true,
  area: true,
  tags: true,
  observations: true,
  startDate: true,
  targetDate: true,
  targetTimeHours: true,
  realHours: true,
  completedAt: true,
  responsible: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  participants: {
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, role: true } },
      addedAt: true,
      addedBy: { select: { id: true, name: true } },
    },
    orderBy: { addedAt: "asc" },
  },
  phases: {
    select: {
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
    },
    orderBy: { order: "asc" },
  },
  _count: { select: { comments: true, documents: true, activities: true } },
  createdAt: true,
  updatedAt: true,
} as const;

async function loadProjectForAccess(id: string) {
  return prisma.project.findUnique({
    where: { id },
    select: { id: true, responsibleId: true, createdById: true, deletedAt: true, participants: { select: { userId: true } } },
  });
}

type ProjectDetailRow = Prisma.ProjectGetPayload<{ select: typeof projectDetailSelect }>;

/** Adjunta campos derivados (§4/§10): tiempo/participantes por fase, última actividad. */
async function attachDerivedFields(project: ProjectDetailRow) {
  const [phaseStats, lastActivity] = await Promise.all([
    getPhaseStats(project.id, project.phases),
    getLastActivity(project.id),
  ]);

  return {
    ...project,
    phases: project.phases.map((ph) => ({
      ...ph,
      registeredMinutes: phaseStats.get(ph.id)?.registeredMinutes ?? 0,
      participants: phaseStats.get(ph.id)?.participants ?? [],
    })),
    lastActivity: lastActivity ? { authorName: lastActivity.authorName, createdAt: lastActivity.createdAt } : null,
  };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const access = await loadProjectForAccess(id);
  // Un proyecto en la papelera no es visible por esta ruta — se administra
  // únicamente desde la Papelera (GET /api/projects/trash + restore/permanent).
  if (!access || access.deletedAt) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canViewProject(session, access, access.participants.map((p) => p.userId))) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { id }, select: projectDetailSelect });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const canSeeRealEmails = canManageUsers(session.role);
  const withDerived = await attachDerivedFields(project);
  return NextResponse.json({
    ...withDerived,
    responsible: { ...withDerived.responsible, email: maskEmailUnless(withDerived.responsible.email, canSeeRealEmails) },
    participants: withDerived.participants.map((p) => ({
      ...p,
      user: { ...p.user, email: maskEmailUnless(p.user.email, canSeeRealEmails) },
    })),
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const access = await loadProjectForAccess(id);
  if (!access || access.deletedAt) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!isProjectManager(session, access)) {
    return NextResponse.json({ error: "No tienes permiso para modificar este proyecto" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const current = await prisma.project.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const {
    name,
    description,
    area,
    tags,
    observations,
    startDate,
    targetDate,
    targetTimeHours,
    priority,
    status,
    responsibleId,
  } = body as {
    name?: string;
    description?: string;
    area?: string;
    tags?: string[];
    observations?: string;
    startDate?: string;
    targetDate?: string;
    targetTimeHours?: number;
    priority?: TaskPriority;
    status?: ProjectStatus;
    responsibleId?: string;
  };

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (description !== undefined) data.description = description?.trim() || null;
  if (area !== undefined) data.area = area?.trim() || null;
  if (tags !== undefined) data.tags = Array.isArray(tags) ? tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()) : [];
  if (observations !== undefined) data.observations = observations?.trim() || null;
  if (startDate !== undefined) data.startDate = new Date(startDate);
  if (targetDate !== undefined) data.targetDate = new Date(targetDate);
  if (priority !== undefined) data.priority = priority;
  if (targetTimeHours !== undefined) {
    const hoursValue = parseFloat(String(targetTimeHours));
    if (Number.isNaN(hoursValue) || hoursValue <= 0) {
      return NextResponse.json({ error: "El tiempo objetivo global debe ser mayor a 0" }, { status: 400 });
    }
    data.targetTimeHours = hoursValue;
  }

  if (status !== undefined && status !== current.status) {
    data.status = status;
    data.completedAt = status === "COMPLETADO" ? new Date() : null;
  }

  if (responsibleId !== undefined && responsibleId !== current.responsibleId) {
    const newResponsible = await prisma.user.findUnique({ where: { id: responsibleId } });
    if (!newResponsible) {
      return NextResponse.json({ error: "Responsable principal inválido" }, { status: 400 });
    }
    data.responsibleId = responsibleId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id }, data, select: projectDetailSelect });

    if (responsibleId !== undefined && responsibleId !== current.responsibleId) {
      await tx.projectParticipant.upsert({
        where: { projectId_userId: { projectId: id, userId: responsibleId } },
        update: {},
        create: { projectId: id, userId: responsibleId, addedById: session.userId },
      });
    }

    return project;
  });

  if (status !== undefined && status !== current.status) {
    await logProjectHistory({
      projectId: id,
      actorId: session.userId,
      event: "ESTADO_CAMBIADO",
      description: `${session.name} cambió el estado de "${current.name}" de ${current.status} a ${status}`,
      previousValue: { status: current.status },
      newValue: { status },
    });
  }

  if (responsibleId !== undefined && responsibleId !== current.responsibleId) {
    await logProjectHistory({
      projectId: id,
      actorId: session.userId,
      event: "RESPONSABLE_CAMBIADO",
      description: `${session.name} cambió el responsable principal de "${current.name}"`,
      previousValue: { responsibleId: current.responsibleId },
      newValue: { responsibleId },
    });
  }

  // Sprint 2.1 §1: ediciones de campos no estratégicos (nombre, descripción,
  // área, etiquetas, observaciones, fechas, tiempo objetivo) ya NO generan un
  // evento genérico "ACTUALIZADO" — el historial solo registra eventos
  // relevantes de negocio (estado, responsable, fases, participantes,
  // documentos, papelera/restauración), no cada edición intermedia.

  return NextResponse.json(await attachDerivedFields(updated));
}

/** Mueve el proyecto a la papelera (Centro de Recuperación) — no es un borrado físico. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const access = await loadProjectForAccess(id);
  if (!access || access.deletedAt) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!isProjectCreator(session, access)) {
    return NextResponse.json({ error: "Solo el creador del proyecto puede enviarlo a la papelera" }, { status: 403 });
  }

  const current = await prisma.project.findUnique({ where: { id }, select: { name: true } });

  try {
    await recoveryCenter.moveToTrash({ entityType: "PROJECT", entityId: id, userId: session.userId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof recoveryCenter.RecoveryError ? err.message : "Error al mover a la papelera" }, { status: 409 });
  }

  await logProjectHistory({
    projectId: id,
    actorId: session.userId,
    event: "ELIMINADO",
    description: `${session.name} movió el proyecto "${current?.name}" a la papelera`,
  });

  return NextResponse.json({ success: true });
}
