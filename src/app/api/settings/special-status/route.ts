import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invalidateAnalyticsCache } from "@/lib/analytics";
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

  const { userId, type, startDate, endDate, dailyHours, limitLow, limitBase, limitHigh, limitOverload } = body as {
    userId?: string;
    type?: string;
    startDate?: string;
    endDate?: string | null;
    dailyHours?: number;
    limitLow?: number;
    limitBase?: number;
    limitHigh?: number;
    limitOverload?: number;
  };

  if (!userId || !startDate || (type !== "MATERNIDAD" && type !== "LACTANCIA")) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const limitFields = { dailyHours, limitLow, limitBase, limitHigh, limitOverload };
  for (const [key, value] of Object.entries(limitFields)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 24) {
      return NextResponse.json({ error: `El campo ${key} debe ser un número entre 0 y 24 horas` }, { status: 400 });
    }
  }
  // Mismo orden que exige la configuración global de carga laboral: cada límite
  // debe ser estrictamente creciente respecto al anterior (limitBase puede
  // coincidir con limitHigh solo si dailyHours no se usa como umbral — pero para
  // evitar semáforos degenerados exigimos el mismo orden estricto de siempre).
  if (!(limitLow! < limitBase! && limitBase! <= limitHigh! && limitHigh! < limitOverload!)) {
    return NextResponse.json(
      { error: "Los límites deben cumplir: Subutilización < Moderado/Óptimo ≤ Óptimo/Elevada < Elevada/Sobrecarga" },
      { status: 400 }
    );
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
      dailyHours: dailyHours!,
      limitLow: limitLow!,
      limitBase: limitBase!,
      limitHigh: limitHigh!,
      limitOverload: limitOverload!,
      createdBy: session.userId,
    },
    include: { user: { select: { id: true, name: true } } },
  });
  invalidateAnalyticsCache(userId);
  return NextResponse.json(record, { status: 201 });
}
