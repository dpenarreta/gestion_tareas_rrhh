import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const taskId = request.nextUrl.searchParams.get("taskId");
    if (!taskId) {
      return NextResponse.json({ error: "Falta el parámetro taskId" }, { status: 400 });
    }

    const reminders = await prisma.followUpReminder.findMany({
      where: { taskId, userId: session.userId, completedAt: null },
      select: reminderSelect,
      orderBy: { reminderAt: "asc" },
    });

    return NextResponse.json(reminders);
  } catch (err) {
    console.error("GET /api/reminders error:", err);
    return NextResponse.json({ error: "Error interno al listar recordatorios" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
    }

    const { taskId, title, description, reminderAt } = body as {
      taskId?: string;
      title?: string;
      description?: string;
      reminderAt?: string;
    };

    if (!taskId || !title?.trim() || !reminderAt) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    const reminder = await prisma.followUpReminder.create({
      data: {
        taskId,
        userId: session.userId,
        title: title.trim(),
        description: description?.trim() || null,
        reminderAt: new Date(reminderAt),
      },
      select: reminderSelect,
    });

    return NextResponse.json(reminder, { status: 201 });
  } catch (err) {
    console.error("POST /api/reminders error:", err);
    return NextResponse.json({ error: "Error interno al crear el recordatorio" }, { status: 500 });
  }
}
