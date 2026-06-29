import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({
      where: { userId: session.userId, read: false },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  await prisma.notification.updateMany({
    where: { userId: session.userId, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
