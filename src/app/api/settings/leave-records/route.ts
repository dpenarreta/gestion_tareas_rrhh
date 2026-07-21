import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isBusinessDay } from "@/lib/businessTime";
import { getHolidaySet } from "@/lib/holidays";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { LeaveType } from "@/generated/prisma/client";

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const userId = request.nextUrl.searchParams.get("userId") || undefined;
  const month = request.nextUrl.searchParams.get("month"); // "YYYY-MM"

  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 1) - 1) };
  }

  const records = await prisma.leaveRecord.findMany({
    where,
    include: { user: { select: { id: true, name: true } } },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(records);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { userId, type, startDate, endDate, isFullDay, durationMinutes, observation } = body as {
    userId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    isFullDay?: boolean;
    durationMinutes?: number;
    observation?: string;
  };

  if (
    !userId ||
    !startDate ||
    !endDate ||
    (type !== "MEDICO" && type !== "PERSONAL" && type !== "VACACIONES") ||
    typeof isFullDay !== "boolean"
  ) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const parsedStart = parseDateOnly(startDate);
  const parsedEnd = parseDateOnly(endDate);
  if (!parsedStart || !parsedEnd) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  if (parsedEnd < parsedStart) {
    return NextResponse.json({ error: "La fecha fin debe ser igual o posterior a la fecha inicio" }, { status: 400 });
  }

  if (type === "VACACIONES" && !isFullDay) {
    return NextResponse.json({ error: "Las vacaciones siempre son de día completo" }, { status: 400 });
  }
  if (!isFullDay) {
    if (!Number.isInteger(durationMinutes) || durationMinutes! <= 0 || durationMinutes! > 1440) {
      return NextResponse.json({ error: "La duración debe ser un número de minutos entre 1 y 1440" }, { status: 400 });
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const holidays = await getHolidaySet();
  const businessDays: Date[] = [];
  for (let t = parsedStart.getTime(); t <= parsedEnd.getTime(); t += 86400000) {
    const d = new Date(t);
    if (isBusinessDay(d) && !holidays.has(d.getTime())) businessDays.push(d);
  }
  if (businessDays.length === 0) {
    return NextResponse.json({ error: "El rango seleccionado no incluye días laborables" }, { status: 400 });
  }

  const trimmedObservation = observation?.trim() || null;
  const records = await prisma.$transaction(
    businessDays.map((date) =>
      prisma.leaveRecord.create({
        data: {
          userId,
          type: type as LeaveType,
          date,
          isFullDay,
          durationMinutes: isFullDay ? null : durationMinutes,
          observation: trimmedObservation,
          createdBy: session.userId,
        },
        include: { user: { select: { id: true, name: true } } },
      })
    )
  );
  invalidateAnalyticsCache(userId);
  return NextResponse.json({ records, businessDaysCount: businessDays.length }, { status: 201 });
}
