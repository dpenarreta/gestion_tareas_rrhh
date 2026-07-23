import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import { advanceRepeat } from "@/lib/deskReminders";
import { logDeskAudit } from "@/lib/deskAudit";
import type { ReminderPriority, ReminderRepeat } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const VALID_PRIORITIES: ReminderPriority[] = ["BAJA", "MEDIA", "ALTA", "URGENTE"];
const VALID_REPEATS: ReminderRepeat[] = ["UNA_VEZ", "DIARIO", "SEMANAL", "MENSUAL"];

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

function serialize(r: {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date;
  priority: ReminderPriority;
  status: string;
  repeat: ReminderRepeat;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    ...r,
    dueAt: r.dueAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const reminder = await prisma.personalReminder.findUnique({ where: { id } });
  if (!reminder || reminder.userId !== session.userId) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  // Completar — si es repetitivo, genera automáticamente la siguiente ocurrencia (§8).
  if (body.action === "complete") {
    const updated = await prisma.personalReminder.update({
      where: { id },
      data: { status: "COMPLETADO", completedAt: new Date() },
      select: reminderSelect,
    });
    await logDeskAudit({ entityType: "REMINDER", entityId: id, userId: session.userId, action: "COMPLETED" });

    if (reminder.repeat !== "UNA_VEZ") {
      const next = await prisma.personalReminder.create({
        data: {
          userId: session.userId,
          title: reminder.title,
          description: reminder.description,
          dueAt: advanceRepeat(reminder.dueAt, reminder.repeat),
          priority: reminder.priority,
          repeat: reminder.repeat,
        },
        select: reminderSelect,
      });
      await logDeskAudit({
        entityType: "REMINDER",
        entityId: next.id,
        userId: session.userId,
        action: "CREATED",
        metadata: { nextOccurrenceOf: id },
      });
    }

    return NextResponse.json(serialize(updated));
  }

  // Posponer (§10) — solo mueve dueAt, mantiene estado pendiente y reabre la notificación.
  if (body.action === "postpone") {
    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "Fecha/hora inválida" }, { status: 400 });
    }
    const updated = await prisma.personalReminder.update({
      where: { id },
      data: { dueAt, status: "PENDIENTE", completedAt: null, notified: false },
      select: reminderSelect,
    });
    await logDeskAudit({
      entityType: "REMINDER",
      entityId: id,
      userId: session.userId,
      action: "POSTPONED",
      metadata: { from: reminder.dueAt.toISOString(), to: dueAt.toISOString() },
    });
    return NextResponse.json(serialize(updated));
  }

  // Edición directa de campos.
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    if (!body.title.trim()) return NextResponse.json({ error: "El título no puede estar vacío" }, { status: 400 });
    data.title = body.title.trim();
  }
  if (typeof body.description === "string") {
    data.description = body.description.trim() || null;
  }
  if (typeof body.dueAt === "string") {
    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: "Fecha/hora inválida" }, { status: 400 });
    data.dueAt = dueAt;
    data.notified = false;
  }
  if (typeof body.repeat === "string" && VALID_REPEATS.includes(body.repeat)) {
    data.repeat = body.repeat;
  }

  let newPriority: ReminderPriority | null = null;
  if (typeof body.priority === "string" && VALID_PRIORITIES.includes(body.priority) && body.priority !== reminder.priority) {
    newPriority = body.priority as ReminderPriority;
    data.priority = newPriority;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(serialize(reminder));
  }

  const updated = await prisma.personalReminder.update({ where: { id }, data, select: reminderSelect });

  await logDeskAudit({
    entityType: "REMINDER",
    entityId: id,
    userId: session.userId,
    action: newPriority ? "PRIORITY_CHANGED" : "EDITED",
    metadata: newPriority ? { from: reminder.priority, to: newPriority } : undefined,
  });

  return NextResponse.json(serialize(updated));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const reminder = await prisma.personalReminder.findUnique({ where: { id }, select: { userId: true } });
  if (!reminder || reminder.userId !== session.userId) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }

  await prisma.personalReminder.delete({ where: { id } });
  await logDeskAudit({ entityType: "REMINDER", entityId: id, userId: session.userId, action: "DELETED" });

  return NextResponse.json({ ok: true });
}
