import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";

const CAN_POST: string[] = ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const now = new Date();
  const announcements = await prisma.announcement.findMany({
    where: { expiresAt: { gt: now } },
    include: { author: { select: { name: true, role: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(announcements);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!CAN_POST.includes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { title, content, durationDays, pinned } = await request.json();
  if (!title?.trim() || !content?.trim() || !durationDays) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  const days = Math.max(1, Math.min(30, Number(durationDays)));

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  const announcement = await prisma.announcement.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      authorId: session.userId,
      expiresAt,
      pinned: Boolean(pinned),
    },
  });

  // Notify all visible users
  const visibleRoles = getVisibleRoles(session.role);
  const targets = await prisma.user.findMany({
    where: { role: { in: visibleRoles }, id: { not: session.userId } },
    select: { id: true },
  });

  if (targets.length > 0) {
    await prisma.notification.createMany({
      data: targets.map((u) => ({
        userId: u.id,
        message: `Nuevo comunicado: "${announcement.title}"`,
      })),
    });
  }

  return NextResponse.json(announcement, { status: 201 });
}
