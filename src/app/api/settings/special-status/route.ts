import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { SpecialStatusType } from "@/generated/prisma/client";

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
  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;

  const records = await prisma.specialStatus.findMany({
    where,
    include: { user: { select: { id: true, name: true } } },
    orderBy: { startDate: "desc" },
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

  const { userId, type, startDate, endDate } = body as {
    userId?: string;
    type?: string;
    startDate?: string;
    endDate?: string | null;
  };

  if (!userId || !startDate || (type !== "MATERNIDAD" && type !== "LACTANCIA")) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const parsedStart = parseDateOnly(startDate);
  if (!parsedStart) {
    return NextResponse.json({ error: "Fecha de inicio inválida" }, { status: 400 });
  }
  let parsedEnd: Date | null = null;
  if (endDate) {
    parsedEnd = parseDateOnly(endDate);
    if (!parsedEnd) {
      return NextResponse.json({ error: "Fecha de fin inválida" }, { status: 400 });
    }
    if (parsedEnd < parsedStart) {
      return NextResponse.json({ error: "La fecha fin debe ser igual o posterior a la fecha inicio" }, { status: 400 });
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const record = await prisma.specialStatus.create({
    data: {
      userId,
      type: type as SpecialStatusType,
      startDate: parsedStart,
      endDate: parsedEnd,
      createdBy: session.userId,
    },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json(record, { status: 201 });
}
