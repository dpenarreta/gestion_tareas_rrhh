import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { businessBaseForRange } from "@/lib/workload";
import type { TaskFrequency, MonthClosureType } from "@/generated/prisma/client";

const RECURRING_FREQUENCIES: TaskFrequency[] = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"];

// Task dates are stored as UTC-midnight calendar days (date-only inputs parse that way).
// All month/day arithmetic here must use the UTC getters/Date.UTC — local getters would
// shift the calendar day depending on the server's timezone offset.
function nextMonthStartUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1));
}

function periodStartUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function daysInMonthUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Último día calendario del mes, medianoche UTC — mismo formato/convención que Task.endDate. Default de la Fecha de Corte cuando no se especifica una. */
function naturalCutoffUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

function shiftToNextMonth(date: Date, nextYear: number, nextMonth: number) {
  const day = Math.min(date.getUTCDate(), daysInMonthUTC(nextYear, nextMonth));
  return new Date(Date.UTC(
    nextYear,
    nextMonth - 1,
    day,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));
}

// Una tarea es "candidata" a cerrarse (archivarse) este mes si:
//   - es FIJA (cualquier estado, comportamiento sin cambios), o
//   - es SEGUIMIENTO y ya está COMPLETADA.
// Las SEGUIMIENTO en PENDIENTE/EN_PROGRESO no se tocan: continúan activas en
// el sistema con toda su trazabilidad (actividades, avance, horas) intacta.
const CANDIDATE_WHERE = {
  OR: [
    { type: "FIJA" as const },
    { type: "SEGUIMIENTO" as const, status: "COMPLETADA" as const },
  ],
};

// Default target month for the closure modal: the calendar month before the
// current one (e.g. opened in August defaults to closing July). Uses local
// (server wall-clock) getters on `now` deliberately — this is about "what
// month is it right now", not about the UTC-midnight Task date fields.
function previousMonth(now: Date) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function parseYearMonth(yearParam: string | null, monthParam: string | null): { year: number; month: number } | null {
  if (yearParam === null && monthParam === null) return null;
  const year = Number(yearParam);
  const month = Number(monthParam);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

/**
 * Motor de Cierre Inteligente con Fecha de Corte — resuelve y valida la
 * Fecha de Corte del asistente. Sin parámetro, replica el comportamiento
 * anterior a este sprint (corte = último día calendario del mes). Debe caer
 * DENTRO del propio mes (no se puede cortar un mes con una fecha de otro
 * mes) y nunca en el futuro (no se puede cerrar "hasta" un día que aún no
 * ocurrió).
 */
function resolveCutoffDate(year: number, month: number, raw: string | null, now: Date): { cutoffDate: Date } | { error: string } {
  const periodStart = periodStartUTC(year, month);
  const naturalCutoff = naturalCutoffUTC(year, month);
  if (raw === null || raw === "") return { cutoffDate: naturalCutoff };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { error: "Fecha de corte inválida" };
  const cutoffDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(cutoffDate.getTime())) return { error: "Fecha de corte inválida" };
  if (cutoffDate.getTime() < periodStart.getTime() || cutoffDate.getTime() > naturalCutoff.getTime()) {
    return { error: "La fecha de corte debe estar dentro del período seleccionado" };
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (cutoffDate.getTime() > today.getTime()) {
    return { error: "La fecha de corte no puede ser posterior a hoy" };
  }
  return { cutoffDate };
}

/**
 * NORMAL: el corte coincide con el último día del período (comportamiento
 * estándar). EARLY: el cierre se ejecuta ANTES de que el período termine
 * (`now` cae dentro del propio mes) — un cierre genuinamente anticipado.
 * MANUAL: el período ya terminó, pero igual se eligió un corte anterior al
 * último día (regularización/auditoría/incidencia posterior al cierre
 * natural del mes). Definición confirmada explícitamente para este sprint.
 */
function determineClosureType(year: number, month: number, cutoffDate: Date, now: Date): MonthClosureType {
  const naturalCutoff = naturalCutoffUTC(year, month);
  if (cutoffDate.getTime() === naturalCutoff.getTime()) return "NORMAL";
  const naturalEndInstant = new Date(Date.UTC(year, month, 1) - 1);
  return now.getTime() <= naturalEndInstant.getTime() ? "EARLY" : "MANUAL";
}

async function buildPreview(year: number, month: number, cutoffDate: Date, now: Date) {
  const monthEnd = nextMonthStartUTC(year, month);
  const periodStart = periodStartUTC(year, month);

  const [existing, candidateTasks, continuedActive, biz] = await Promise.all([
    prisma.monthClosure.findUnique({ where: { month_year: { month, year } } }),
    prisma.task.findMany({
      where: { archivedMonth: null, endDate: { lt: monthEnd }, ...CANDIDATE_WHERE },
      select: { status: true },
    }),
    prisma.task.count({
      where: {
        archivedMonth: null,
        endDate: { lt: monthEnd },
        type: "SEGUIMIENTO",
        status: { in: ["PENDIENTE", "EN_PROGRESO"] },
      },
    }),
    businessBaseForRange(periodStart, cutoffDate),
  ]);

  const total = candidateTasks.length;
  const completed = candidateTasks.filter((t) => t.status === "COMPLETADA").length;
  const pending = candidateTasks.filter((t) => t.status === "PENDIENTE").length;
  const inProgress = candidateTasks.filter((t) => t.status === "EN_PROGRESO").length;

  return {
    year,
    month,
    monthEnd,
    alreadyClosed: !!existing,
    total,
    completed,
    pending,
    inProgress,
    continuedActive,
    cutoffDate: cutoffDate.toISOString().slice(0, 10),
    closureType: determineClosureType(year, month, cutoffDate, now),
    calendarDaysTotal: daysInMonthUTC(year, month),
    calendarDaysConsidered: cutoffDate.getUTCDate(),
    workingDaysConsidered: biz.businessDays,
    workingHoursConsidered: biz.baseHours,
    // Cierre existente (para el aviso del wizard de reportes, Fase 9) — null si nunca se cerró.
    existingCutoffDate: existing ? existing.cutoffDate.toISOString().slice(0, 10) : null,
    existingClosureType: existing ? existing.closureType : null,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos para cerrar el mes" }, { status: 403 });
  }

  const parsed = parseYearMonth(
    request.nextUrl.searchParams.get("year"),
    request.nextUrl.searchParams.get("month")
  );
  if (request.nextUrl.searchParams.get("year") !== null && parsed === null) {
    return NextResponse.json({ error: "Año o mes inválido" }, { status: 400 });
  }
  const { year, month } = parsed ?? previousMonth(new Date());

  const now = new Date();
  const cutoffResult = resolveCutoffDate(year, month, request.nextUrl.searchParams.get("cutoffDate"), now);
  if ("error" in cutoffResult) return NextResponse.json({ error: cutoffResult.error }, { status: 400 });

  const preview = await buildPreview(year, month, cutoffResult.cutoffDate, now);
  return NextResponse.json(preview);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos para cerrar el mes" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = parseYearMonth(
    body.year !== undefined ? String(body.year) : null,
    body.month !== undefined ? String(body.month) : null
  );
  if (body.year !== undefined && parsed === null) {
    return NextResponse.json({ error: "Año o mes inválido" }, { status: 400 });
  }
  const { year, month } = parsed ?? previousMonth(new Date());

  const now = new Date();
  const cutoffResult = resolveCutoffDate(year, month, typeof body.cutoffDate === "string" ? body.cutoffDate : null, now);
  if ("error" in cutoffResult) return NextResponse.json({ error: cutoffResult.error }, { status: 400 });
  const { cutoffDate } = cutoffResult;

  const { monthEnd, alreadyClosed, closureType, calendarDaysTotal, calendarDaysConsidered, workingDaysConsidered, workingHoursConsidered } =
    await buildPreview(year, month, cutoffDate, now);
  if (alreadyClosed) {
    return NextResponse.json({ error: "Este mes ya fue cerrado" }, { status: 409 });
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const [candidateTasks, continuedActive] = await Promise.all([
    prisma.task.findMany({
      where: { archivedMonth: null, endDate: { lt: monthEnd }, ...CANDIDATE_WHERE },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        frequency: true,
        type: true,
        startDate: true,
        endDate: true,
        estimatedHours: true,
        assignedToId: true,
        createdById: true,
        color: true,
      },
    }),
    prisma.task.count({
      where: {
        archivedMonth: null,
        endDate: { lt: monthEnd },
        type: "SEGUIMIENTO",
        status: { in: ["PENDIENTE", "EN_PROGRESO"] },
      },
    }),
  ]);

  const total = candidateTasks.length;
  const completed = candidateTasks.filter((t) => t.status === "COMPLETADA").length;
  const pending = candidateTasks.filter((t) => t.status === "PENDIENTE").length;
  const inProgress = candidateTasks.filter((t) => t.status === "EN_PROGRESO").length;

  const duplicates = candidateTasks
    .filter((t) => RECURRING_FREQUENCIES.includes(t.frequency))
    .map((t) => ({
      title: t.title,
      description: t.description,
      status: "PENDIENTE" as const,
      priority: t.priority,
      frequency: t.frequency,
      type: t.type,
      startDate: shiftToNextMonth(t.startDate, nextYear, nextMonth),
      endDate: shiftToNextMonth(t.endDate, nextYear, nextMonth),
      estimatedHours: t.estimatedHours,
      realHours: 0,
      progress: 0,
      assignedToId: t.assignedToId,
      createdById: t.createdById,
      color: t.color,
    }));

  const archivedMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const taskIds = candidateTasks.map((t) => t.id);

  await prisma.$transaction(
    [
      prisma.monthClosure.create({
        data: {
          month,
          year,
          closedBy: session.userId,
          cutoffDate,
          closureType,
          calendarDaysTotal,
          calendarDaysConsidered,
          workingDaysConsidered,
          workingHoursConsidered,
          totalTasks: total,
          completedTasks: completed,
          summary: { total, completed, pending, inProgress, duplicated: duplicates.length, continuedActive },
        },
      }),
      prisma.task.updateMany({
        where: { id: { in: taskIds } },
        data: { archivedMonth: archivedMonthKey, archivedAt: new Date() },
      }),
      ...(duplicates.length > 0 ? [prisma.task.createMany({ data: duplicates })] : []),
    ],
    { timeout: 30000 }
  );

  invalidateAnalyticsCache();

  return NextResponse.json({
    archivedCount: total,
    duplicatedCount: duplicates.length,
    continuedActiveCount: continuedActive,
    month,
    year,
    nextMonth,
    nextYear,
    cutoffDate: cutoffDate.toISOString().slice(0, 10),
    closureType,
    calendarDaysTotal,
    calendarDaysConsidered,
    workingDaysConsidered,
    workingHoursConsidered,
  });
}
