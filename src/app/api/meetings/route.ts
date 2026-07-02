import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canCreateMeetings } from "@/lib/roles";
import { createZoomMeeting } from "@/lib/zoom";

const meetingInclude = {
  host: { select: { id: true, name: true, role: true } },
  invitees: {
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { user: { name: "asc" as const } },
  },
} as const;

function serialize(m: {
  id: string; title: string; description: string | null; hostId: string;
  meetingDate: Date; duration: number; zoomMeetingId: string | null;
  zoomJoinUrl: string | null; zoomPassword: string | null; status: string;
  otterInvited: boolean; otterSummary: string | null; otterTranscriptUrl: string | null;
  createdAt: Date; updatedAt: Date;
  host: { id: string; name: string; role: string };
  invitees: { id: string; userId: string; attended: boolean; user: { id: string; name: string; role: string } }[];
}) {
  return {
    ...m,
    meetingDate: m.meetingDate.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const meetings = await prisma.meeting.findMany({
    where: {
      OR: [
        { hostId: session.userId },
        { invitees: { some: { userId: session.userId } } },
      ],
    },
    include: meetingInclude,
    orderBy: { meetingDate: "asc" },
  });

  return NextResponse.json(meetings.map(serialize));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canCreateMeetings(session.role)) {
    return NextResponse.json({ error: "Sin permisos para crear reuniones" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo de solicitud inválido" }, { status: 400 });

    const { title, description, meetingDate, duration, inviteeIds } = body;
    if (!title?.trim() || !meetingDate || !duration) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    let zoomMeetingId: string;
    let zoomJoinUrl: string;
    let zoomPassword: string;
    let zoomWarning: string | null = null;

    try {
      const zoomMeeting = await createZoomMeeting(title.trim(), new Date(meetingDate), 40);
      zoomMeetingId = zoomMeeting.zoomMeetingId;
      zoomJoinUrl = zoomMeeting.zoomJoinUrl;
      zoomPassword = zoomMeeting.zoomPassword;
    } catch (zoomErr) {
      console.error("[POST /api/meetings] Zoom API falló, usando link simulado", zoomErr);
      zoomMeetingId = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000);
      zoomJoinUrl = `https://zoom.us/j/${zoomMeetingId}`;
      zoomPassword = Math.random().toString(36).slice(2, 8).toUpperCase();
      zoomWarning = "No se pudo conectar con Zoom. Se generó un enlace simulado.";
    }

    const ids: string[] = Array.isArray(inviteeIds)
      ? inviteeIds.filter((id: string) => id !== session.userId)
      : [];

    const meeting = await prisma.meeting.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        hostId: session.userId,
        meetingDate: new Date(meetingDate),
        duration: Number(duration),
        zoomMeetingId,
        zoomJoinUrl,
        zoomPassword,
        invitees: ids.length > 0 ? { create: ids.map((userId) => ({ userId })) } : undefined,
      },
      include: meetingInclude,
    });

    if (ids.length > 0) {
      await prisma.notification.createMany({
        data: ids.map((userId) => ({
          userId,
          message: `Te invitaron a la reunión "${meeting.title}"`,
          taskTitle: meeting.title,
        })),
      });
    }

    return NextResponse.json({ ...serialize(meeting), zoomWarning }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/meetings]", err);
    return NextResponse.json({ error: "Error al crear la reunión" }, { status: 500 });
  }
}
