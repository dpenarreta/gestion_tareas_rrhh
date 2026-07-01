import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const PREFIX = "DASHBOARD_CARDS:";

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { order } = await request.json();
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order debe ser un array no vacío" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { viewPreferences: true },
  });

  const existing = (user?.viewPreferences ?? []).filter((v) => !v.startsWith(PREFIX));
  const updated = [...existing, `${PREFIX}${order.join(",")}`];

  await prisma.user.update({
    where: { id: session.userId },
    data: { viewPreferences: updated },
  });

  return NextResponse.json({ ok: true });
}
