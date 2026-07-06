import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const reminderSelect = {
  id: true,
  taskId: true,
  title: true,
  description: true,
  reminderAt: true,
  snoozedUntil: true,
  completedAt: true,
  createdAt: true,
} as const;

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const reminder = await prisma.followUpReminder.findUnique({ where: { id } });
    if (!reminder || reminder.userId !== session.userId) {
      return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
    }

    const { completed, snoozedUntil, reminderAt, title, description } = body as {
      completed?: boolean;
      snoozedUntil?: string;
      reminderAt?: string;
      title?: string;
      description?: string;
    };

    const data: Prisma.FollowUpReminderUpdateInput = {};

    if (typeof completed === "boolean") {
      data.completedAt = completed ? new Date() : null;
    }
    if (reminderAt) {
      data.reminderAt = new Date(reminderAt);
      data.snoozedUntil = null;
      data.completedAt = null;
    }
    if (snoozedUntil) {
      data.snoozedUntil = new Date(snoozedUntil);
    }
    if (typeof title === "string") {
      if (!title.trim()) {
        return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
      }
      data.title = title.trim();
    }
    if (typeof description === "string") {
      data.description = description.trim() || null;
    }

    const updated = await prisma.followUpReminder.update({
      where: { id },
      data,
      select: reminderSelect,
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/reminders/[id] error:", err);
    return NextResponse.json({ error: "Error interno al actualizar el recordatorio" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const reminder = await prisma.followUpReminder.findUnique({ where: { id } });
    if (!reminder || reminder.userId !== session.userId) {
      return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
    }

    await prisma.followUpReminder.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/reminders/[id] error:", err);
    return NextResponse.json({ error: "Error interno al eliminar el recordatorio" }, { status: 500 });
  }
}
