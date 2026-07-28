import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject, isProjectParticipant } from "@/lib/projectAccess";
import { businessCalendarDay, businessDayRealRange, retroactiveValidDates, parseDateOnly } from "@/lib/businessTime";
import { getEffectiveRetroactiveWindowDays } from "@/lib/systemConfig";
import { timeToMinutes } from "@/lib/timeOverlap";
import { logProjectHistory } from "@/lib/projectHistory";
import { recalcProjectRealHours } from "@/lib/recalcHours";

type Ctx = { params: Promise<{ id: string }> };

// Sprint 2.1 §7: descripción obligatoria, mínimo 15 caracteres.
const MIN_DESCRIPTION_LENGTH = 15;

const activitySelect = {
  id: true,
  phaseId: true,
  description: true,
  comments: true,
  startTime: true,
  endTime: true,
  duration: true,
  isRetroactive: true,
  activityDate: true,
  author: { select: { id: true, name: true } },
  createdAt: true,
  documents: { select: { id: true, fileName: true, category: true, mimeType: true } },
} as const;

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

  const { description, comments, startTime, endTime, phaseId, activityDate } = body as {
    description?: string;
    comments?: string;
    startTime?: string;
    endTime?: string;
    phaseId?: string;
    activityDate?: string;
  };

  // Sprint 2.1 §7: descripción siempre obligatoria, mínimo 15 caracteres.
  if (!description?.trim() || description.trim().length < MIN_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `La descripción es obligatoria y debe tener al menos ${MIN_DESCRIPTION_LENGTH} caracteres` },
      { status: 400 }
    );
  }

  // Sprint 2.1 §6: se eliminó el campo de duración manual — se registra
  // únicamente hora inicio/hora fin y la duración se calcula siempre desde
  // ese rango (mismo parser que la validación de solapamiento de Tareas).
  if (!startTime || !endTime) {
    return NextResponse.json({ error: "La hora de inicio y de fin son obligatorias" }, { status: 400 });
  }
  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);
  if (startMins === null || endMins === null) {
    return NextResponse.json({ error: "Hora inválida" }, { status: 400 });
  }
  if (endMins <= startMins) {
    return NextResponse.json({ error: "La hora fin debe ser posterior a la hora inicio" }, { status: 400 });
  }
  const duration = endMins - startMins;

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
      // Registro retroactivo (§6): misma ventana configurable que Task/Seguimiento
      // (ver src/lib/systemConfig.ts), más el fin de semana inmediato anterior si aún
      // está disponible (ver businessTime.ts).
      const windowDays = await getEffectiveRetroactiveWindowDays();
      const validDates = retroactiveValidDates(today, windowDays);
      const isValidDate = validDates.some((d) => d.getTime() === parsedDate!.getTime());
      if (!isValidDate) {
        return NextResponse.json(
          {
            error:
              `La fecha debe ser hoy, uno de los últimos ${windowDays} días laborables, o el sábado/domingo inmediato anterior si aún está disponible`,
          },
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
      startTime,
      endTime,
      duration,
      isRetroactive,
      activityDate: parsedDate,
      ...(createdAt ? { createdAt } : {}),
    },
    select: activitySelect,
  });

  await recalcProjectRealHours(projectId);

  // Sprint 2.1 §2: "participante" es distinto de responsable/creador — se
  // gana la membresía por asignación explícita O por registrar actividad
  // (aquí). Si quien registró todavía no figura como participante, se lo
  // agrega automáticamente (esto SÍ es un evento relevante de negocio).
  if (!participantIds.includes(session.userId)) {
    await prisma.projectParticipant.create({
      data: { projectId, userId: session.userId, addedById: session.userId },
    });
    await logProjectHistory({
      projectId,
      actorId: session.userId,
      event: "PARTICIPANTE_AGREGADO",
      description: `${session.name} se agregó automáticamente como participante de "${project.name}" al registrar una actividad`,
      newValue: { userId: session.userId, auto: true },
    });
  }

  // Sprint 2.1 §1: el registro de una actividad individual ya NO genera un
  // evento en Historial (antes inundaba el timeline con un evento por cada
  // registro de tiempo) — la vista cronológica dedicada es la pestaña
  // Actividades (§8), no Historial.

  return NextResponse.json(activity, { status: 201 });
}
