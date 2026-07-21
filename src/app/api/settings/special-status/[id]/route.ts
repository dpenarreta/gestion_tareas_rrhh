import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { businessCalendarDay } from "@/lib/businessTime";
import { invalidateAnalyticsCache } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

/** Finaliza el estado especial hoy (o antes, si su fecha fin ya estaba en el pasado). */
export async function PATCH(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.specialStatus.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Estado especial no encontrado" }, { status: 404 });
  }

  // businessCalendarDay desplaza el instante a UTC-5 (huso de negocio) antes de leer
  // el día calendario — un simple new Date(Date.UTC(now.getUTCFullYear(), ...)) se
  // adelantaría hasta 5h y marcaría "hoy" como el día siguiente en horas de la tarde/noche.
  const today = businessCalendarDay(new Date());
  const endDate = !existing.endDate || existing.endDate.getTime() > today.getTime() ? today : existing.endDate;

  const updated = await prisma.specialStatus.update({
    where: { id },
    data: { isActive: false, endDate },
    include: { user: { select: { id: true, name: true } } },
  });
  invalidateAnalyticsCache(existing.userId);
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.specialStatus.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Estado especial no encontrado" }, { status: 404 });
  }

  await prisma.specialStatus.delete({ where: { id } });
  invalidateAnalyticsCache(existing.userId);
  return NextResponse.json({ ok: true });
}
