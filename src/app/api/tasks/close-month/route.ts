import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import type { TaskFrequency } from "@/generated/prisma/client";

const RECURRING_FREQUENCIES: TaskFrequency[] = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"];

// Task dates are stored as UTC-midnight calendar days (date-only inputs parse that way).
// All month/day arithmetic here must use the UTC getters/Date.UTC — local getters would
// shift the calendar day depending on the server's timezone offset.
function nextMonthStartUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1));
}

function daysInMonthUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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

async function buildPreview(year: number, month: number) {
  const monthEnd = nextMonthStartUTC(year, month);

  const [existing, candidateTasks, continuedActive] = await Promise.all([
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
  ]);

  const total = candidateTasks.length;
  const completed = candidateTasks.filter((t) => t.status === "COMPLETADA").length;
  const pending = candidateTasks.filter((t) => t.status === "PENDIENTE").length;
  const inProgress = candidateTasks.filter((t) => t.status === "EN_PROGRESO").length;

  return { year, month, monthEnd, alreadyClosed: !!existing, total, completed, pending, inProgress, continuedActive };
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

  const preview = await buildPreview(year, month);
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

  const { monthEnd, alreadyClosed } = await buildPreview(year, month);
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

  return NextResponse.json({
    archivedCount: total,
    duplicatedCount: duplicates.length,
    continuedActiveCount: continuedActive,
    month,
    year,
    nextMonth,
    nextYear,
  });
}
