import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject, isProjectManager } from "@/lib/projectAccess";
import { canManageUsers } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { logProjectHistory } from "@/lib/projectHistory";
import type { ProjectStatus, TaskPriority } from "@/generated/prisma/client";

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
    select: { id: true, responsibleId: true, createdById: true, participants: { select: { userId: true } } },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const access = await loadProjectForAccess(id);
  if (!access) {
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
  return NextResponse.json({
    ...project,
    responsible: { ...project.responsible, email: maskEmailUnless(project.responsible.email, canSeeRealEmails) },
    participants: project.participants.map((p) => ({
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
  if (!access) {
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

  const otherFieldsChanged = Object.keys(data).some((k) => !["status", "completedAt", "responsibleId"].includes(k));
  if (otherFieldsChanged) {
    await logProjectHistory({
      projectId: id,
      actorId: session.userId,
      event: "ACTUALIZADO",
      description: `${session.name} actualizó los datos del proyecto "${current.name}"`,
    });
  }

  return NextResponse.json(updated);
}
