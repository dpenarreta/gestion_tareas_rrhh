import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invalidateAnalyticsCache } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.leaveRecord.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Permiso no encontrado" }, { status: 404 });
  }

  await prisma.leaveRecord.delete({ where: { id } });
  invalidateAnalyticsCache(existing.userId);
  return NextResponse.json({ ok: true });
}
