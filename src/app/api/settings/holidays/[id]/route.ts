import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Feriado no encontrado" }, { status: 404 });
  }

  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
