import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject, isProjectParticipant } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";
import { businessCalendarDay, businessDayRealRange, previousBusinessDays } from "@/lib/businessTime";

type Ctx = { params: Promise<{ id: string }> };

const activitySelect = {
  id: true,
  phaseId: true,
  description: true,
  comments: true,
  time: true,
  duration: true,
  isRetroactive: true,
  activityDate: true,
  author: { select: { id: true, name: true } },
  createdAt: true,
} as const;

/** "YYYY-MM-DD" (del date picker) -> Date UTC-medianoche. */
function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function recalcRealHours(projectId: string) {
  const activities = await prisma.projectActivity.findMany({ where: { projectId }, select: { duration: true } });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.project.update({
    where: { id: projectId },
    data: { realHours: Math.round((totalMins / 60) * 100) / 100 },
  });
}

async function loadProjectForAccess(id: string) {
  return prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      responsibleId: true,
      createdById: true,
      participants: { select: { userId: true } },
    },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canViewProject(session, project, project.participants.map((p) => p.userId))) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }

  const activities = await prisma.projectActivity.findMany({
    where: { projectId },
    select: activitySelect,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(activities);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const participantIds = project.participants.map((p) => p.userId);
  if (!isProjectParticipant(session, project, participantIds)) {
    return NextResponse.json({ error: "Solo los participantes del proyecto pueden registrar actividades" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { description, comments, time, hours, minutes, phaseId, activityDate } = body as {
    description?: string;
    comments?: string;
    time?: string;
    hours?: number;
    minutes?: number;
    phaseId?: string;
    activityDate?: string;
  };

  if (!description?.trim() || hours === undefined || minutes === undefined) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    return NextResponse.json({ error: "Las horas deben ser un número entre 0 y 23" }, { status: 400 });
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return NextResponse.json({ error: "Los minutos deben ser un número entre 0 y 59" }, { status: 400 });
  }
  const duration = hours * 60 + minutes;
  if (duration <= 0) {
    return NextResponse.json({ error: "La duración debe ser mayor a 0" }, { status: 400 });
  }

  if (phaseId) {
    const phase = await prisma.projectPhase.findUnique({ where: { id: phaseId } });
    if (!phase || phase.projectId !== projectId) {
      return NextResponse.json({ error: "Fase inválida" }, { status: 400 });
    }
  }

  let isRetroactive = false;
  let parsedDate: Date | null = null;
  let createdAt: Date | undefined;

  if (activityDate) {
    parsedDate = parseDateOnly(activityDate);
    if (!parsedDate) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }
    const today = businessCalendarDay(new Date());
    if (parsedDate.getTime() !== today.getTime()) {
      // Registro retroactivo (§6): misma ventana de 2 días hábiles que Task/Seguimiento.
      const validDates = previousBusinessDays(today, 2);
      const isValidDate = validDates.some((d) => d.getTime() === parsedDate!.getTime());
      if (!isValidDate) {
        return NextResponse.json(
          { error: "La fecha debe ser hoy o uno de los últimos 2 días laborables (no incluye fines de semana)" },
          { status: 400 }
        );
      }
      isRetroactive = true;
      createdAt = businessDayRealRange(parsedDate).start;
    }
  }

  const activity = await prisma.projectActivity.create({
    data: {
      projectId,
      phaseId: phaseId || null,
      authorId: session.userId,
      description: description.trim(),
      comments: comments?.trim() || null,
      time: time || null,
      duration,
      isRetroactive,
      activityDate: parsedDate,
      ...(createdAt ? { createdAt } : {}),
    },
    select: activitySelect,
  });

  await recalcRealHours(projectId);

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "ACTIVIDAD_REGISTRADA",
    description: `${session.name} registró ${hours}h ${minutes}m en "${project.name}"${isRetroactive ? " (retroactivo)" : ""}`,
    newValue: { activityId: activity.id, duration },
  });

  return NextResponse.json(activity, { status: 201 });
}
