import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

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

  const yearParam = request.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam) : undefined;

  const holidays = await prisma.holiday.findMany({
    where: year ? { year } : undefined,
    orderBy: { date: "asc" },
  });
  return NextResponse.json(holidays);
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

  const { date, name } = body as { date?: string; name?: string };
  if (!date || !name?.trim()) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  const parsedDate = parseDateOnly(date);
  if (!parsedDate) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }

  const existing = await prisma.holiday.findUnique({ where: { date: parsedDate } });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un feriado registrado en esa fecha" }, { status: 409 });
  }

  const holiday = await prisma.holiday.create({
    data: { date: parsedDate, name: name.trim(), year: parsedDate.getUTCFullYear() },
  });
  return NextResponse.json(holiday, { status: 201 });
}
