import { NextResponse } from "next/server";
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

async function buildPreview() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthEnd = nextMonthStartUTC(year, month);

  const [existing, candidateTasks] = await Promise.all([
    prisma.monthClosure.findUnique({ where: { month_year: { month, year } } }),
    prisma.task.findMany({
      where: { archivedMonth: null, endDate: { lt: monthEnd } },
      select: { status: true },
    }),
  ]);

  const total = candidateTasks.length;
  const completed = candidateTasks.filter((t) => t.status === "COMPLETADA").length;
  const pending = candidateTasks.filter((t) => t.status === "PENDIENTE").length;
  const inProgress = candidateTasks.filter((t) => t.status === "EN_PROGRESO").length;

  return { year, month, monthEnd, alreadyClosed: !!existing, total, completed, pending, inProgress };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos para cerrar el mes" }, { status: 403 });
  }

  const preview = await buildPreview();
  return NextResponse.json(preview);
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos para cerrar el mes" }, { status: 403 });
  }

  const { year, month, monthEnd, alreadyClosed } = await buildPreview();
  if (alreadyClosed) {
    return NextResponse.json({ error: "Este mes ya fue cerrado" }, { status: 409 });
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const candidateTasks = await prisma.task.findMany({
    where: { archivedMonth: null, endDate: { lt: monthEnd } },
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
  });

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
          summary: { total, completed, pending, inProgress, duplicated: duplicates.length },
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
    month,
    year,
    nextMonth,
    nextYear,
  });
}
