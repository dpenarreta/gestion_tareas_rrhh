import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
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

  const { userId, type, date, isFullDay, durationMinutes, observation } = body as {
    userId?: string;
    type?: string;
    date?: string;
    isFullDay?: boolean;
    durationMinutes?: number;
    observation?: string;
  };

  if (!userId || !date || (type !== "MEDICO" && type !== "PERSONAL") || typeof isFullDay !== "boolean") {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  const parsedDate = parseDateOnly(date);
  if (!parsedDate) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
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

  const record = await prisma.leaveRecord.create({
    data: {
      userId,
      type: type as LeaveType,
      date: parsedDate,
      isFullDay,
      durationMinutes: isFullDay ? null : durationMinutes,
      observation: observation?.trim() || null,
      createdBy: session.userId,
    },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json(record, { status: 201 });
}
