import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { notifyDueReminders } from "@/lib/deskReminders";
import { logDeskAudit } from "@/lib/deskAudit";
import type { ReminderPriority, ReminderRepeat } from "@/generated/prisma/client";

const VALID_PRIORITIES: ReminderPriority[] = ["BAJA", "MEDIA", "ALTA", "URGENTE"];
const VALID_REPEATS: ReminderRepeat[] = ["UNA_VEZ", "DIARIO", "SEMANAL", "MENSUAL"];
const MAX_TITLE_LENGTH = 150;

const reminderSelect = {
  id: true,
  title: true,
  description: true,
  dueAt: true,
  priority: true,
  status: true,
  repeat: true,
  completedAt: true,
  createdAt: true,
} as const;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  await notifyDueReminders(session.userId);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // "PENDIENTE" | "COMPLETADO" | null (= todos)
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : undefined;

  const reminders = await prisma.personalReminder.findMany({
    where: {
      userId: session.userId,
      ...(status === "PENDIENTE" || status === "COMPLETADO" ? { status } : {}),
      ...(from || to
        ? { dueAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: reminderSelect,
    orderBy: { dueAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  return NextResponse.json(
    reminders.map((r) => ({
      ...r,
      dueAt: r.dueAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }))
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const dueAtRaw = typeof body?.dueAt === "string" ? body.dueAt : "";
  const priority = VALID_PRIORITIES.includes(body?.priority) ? (body.priority as ReminderPriority) : "MEDIA";
  const repeat = VALID_REPEATS.includes(body?.repeat) ? (body.repeat as ReminderRepeat) : "UNA_VEZ";

  if (!title || !dueAtRaw) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: `El título no puede superar ${MAX_TITLE_LENGTH} caracteres` }, { status: 400 });
  }
  const dueAt = new Date(dueAtRaw);
  if (Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: "Fecha/hora inválida" }, { status: 400 });
  }

  const reminder = await prisma.personalReminder.create({
    data: { userId: session.userId, title, description: description || null, dueAt, priority, repeat },
    select: reminderSelect,
  });

  await logDeskAudit({ entityType: "REMINDER", entityId: reminder.id, userId: session.userId, action: "CREATED" });

  return NextResponse.json(
    { ...reminder, dueAt: reminder.dueAt.toISOString(), completedAt: null, createdAt: reminder.createdAt.toISOString() },
    { status: 201 }
  );
}
