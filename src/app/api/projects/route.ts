import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canCreateProject } from "@/lib/roles";
import { logProjectHistory } from "@/lib/projectHistory";
import { ROLE_LEVEL } from "@/lib/roles";
import type { ProjectStatus, TaskPriority } from "@/generated/prisma/client";

const projectListSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  priority: true,
  area: true,
  tags: true,
  startDate: true,
  targetDate: true,
  targetTimeHours: true,
  realHours: true,
  completedAt: true,
  responsible: { select: { id: true, name: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { participants: true, phases: true, comments: true, documents: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const isLeadership = ROLE_LEVEL[session.role] >= 3;

  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      ...(isLeadership
        ? {}
        : {
            OR: [
              { responsibleId: session.userId },
              { createdById: session.userId },
              { participants: { some: { userId: session.userId } } },
            ],
          }),
    },
    select: projectListSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!canCreateProject(session.role)) {
    return NextResponse.json({ error: "No tienes permiso para crear proyectos" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const {
    name,
    description,
    responsibleId,
    participantIds,
    startDate,
    targetDate,
    status,
    priority,
    targetTimeHours,
    tags,
    area,
    observations,
  } = body as {
    name?: string;
    description?: string;
    responsibleId?: string;
    participantIds?: string[];
    startDate?: string;
    targetDate?: string;
    status?: ProjectStatus;
    priority?: TaskPriority;
    targetTimeHours?: number;
    tags?: string[];
    area?: string;
    observations?: string;
  };

  if (!name?.trim() || !responsibleId || !startDate || !targetDate || !priority || targetTimeHours == null) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const responsible = await prisma.user.findUnique({ where: { id: responsibleId } });
  if (!responsible) {
    return NextResponse.json({ error: "Responsable principal inválido" }, { status: 400 });
  }

  const hoursValue = parseFloat(String(targetTimeHours));
  if (Number.isNaN(hoursValue) || hoursValue <= 0) {
    return NextResponse.json({ error: "El tiempo objetivo global debe ser mayor a 0" }, { status: 400 });
  }

  const participantSet = new Set([responsibleId, ...(Array.isArray(participantIds) ? participantIds : [])]);

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      status: status ?? "PENDIENTE",
      priority,
      area: area?.trim() || null,
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()) : [],
      observations: observations?.trim() || null,
      startDate: new Date(startDate),
      targetDate: new Date(targetDate),
      targetTimeHours: hoursValue,
      responsibleId,
      createdById: session.userId,
      participants: {
        create: Array.from(participantSet).map((userId) => ({
          userId,
          addedById: session.userId,
        })),
      },
    },
    select: projectListSelect,
  });

  await logProjectHistory({
    projectId: project.id,
    actorId: session.userId,
    event: "CREADO",
    description: `${session.name} creó el proyecto "${project.name}"`,
    newValue: { name: project.name, status: project.status, responsibleId },
  });

  return NextResponse.json(project, { status: 201 });
}
