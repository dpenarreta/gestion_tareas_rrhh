import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

const meetingInclude = {
  host: { select: { id: true, name: true, role: true } },
  invitees: {
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { user: { name: "asc" as const } },
  },
} as const;

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id }, include: meetingInclude });
  if (!meeting) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const isParticipant =
    meeting.hostId === session.userId ||
    meeting.invitees.some((inv) => inv.userId === session.userId);
  if (!isParticipant) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  return NextResponse.json({
    ...meeting,
    meetingDate: meeting.meetingDate.toISOString(),
    createdAt: meeting.createdAt.toISOString(),
    updatedAt: meeting.updatedAt.toISOString(),
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id }, select: { hostId: true } });
  if (!meeting) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (meeting.hostId !== session.userId) {
    return NextResponse.json({ error: "Solo el anfitrión puede editar la reunión" }, { status: 403 });
  }

  const body = await request.json();
  const allowed = ["title", "description", "meetingDate", "duration", "status", "otterInvited", "otterSummary", "otterTranscriptUrl"] as const;
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = key === "meetingDate" ? new Date(body[key]) : body[key];
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data,
    include: meetingInclude,
  });

  return NextResponse.json({
    ...updated,
    meetingDate: updated.meetingDate.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id }, select: { hostId: true } });
  if (!meeting) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (meeting.hostId !== session.userId) {
    return NextResponse.json({ error: "Solo el anfitrión puede eliminar la reunión" }, { status: 403 });
  }

  await prisma.meeting.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
