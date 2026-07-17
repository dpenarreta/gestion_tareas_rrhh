import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, kpiStartDate: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(users);
}

export async function PATCH(request: NextRequest) {
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

  const { userId, kpiStartDate } = body as { userId?: string; kpiStartDate?: string | null };
  if (!userId) {
    return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });
  }

  let parsedDate: Date | null = null;
  if (kpiStartDate) {
    parsedDate = parseDateOnly(kpiStartDate);
    if (!parsedDate) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { kpiStartDate: parsedDate },
    select: { id: true, name: true, email: true, role: true, kpiStartDate: true },
  });
  return NextResponse.json(updated);
}
