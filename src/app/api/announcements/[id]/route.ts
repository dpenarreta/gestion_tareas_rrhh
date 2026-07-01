import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

const CAN_DELETE: string[] = ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"];

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!CAN_DELETE.includes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  await prisma.announcement.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
