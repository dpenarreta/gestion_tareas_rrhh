import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { TaskStatus } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const VALID_STATUSES: TaskStatus[] = ["PENDIENTE", "EN_PROGRESO", "COMPLETADA"];

const taskSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  frequency: true,
  startDate: true,
  endDate: true,
  estimatedHours: true,
  realHours: true,
  progress: true,
  color: true,
  corrected: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
  createdAt: true,
  updatedAt: true,
} as const;

type Correction = {
  taskId: string;
  field: "realHours" | "status";
  oldValue: string | number;
  newValue: string | number;
  correctedBy: string;
  correctedAt: string;
};

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json(
      { error: "Solo un Administrador puede corregir tareas archivadas" },
      { status: 403 }
    );
  }

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }
  if (!task.archivedMonth) {
    return NextResponse.json(
      { error: "Solo se pueden corregir tareas archivadas del repositorio" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null) as
    | { realHours?: number | string; status?: string }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { realHours, status } = body;
  if (realHours === undefined && status === undefined) {
    return NextResponse.json({ error: "Nada que corregir" }, { status: 400 });
  }
  if (status !== undefined && !VALID_STATUSES.includes(status as TaskStatus)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const corrections: Correction[] = [];
  const data: Record<string, unknown> = {};

  if (realHours !== undefined) {
    const newRealHours = Math.round(parseFloat(String(realHours)) * 100) / 100;
    if (Number.isNaN(newRealHours) || newRealHours < 0) {
      return NextResponse.json({ error: "Horas reales inválidas" }, { status: 400 });
    }
    if (newRealHours !== task.realHours) {
      corrections.push({
        taskId: task.id,
        field: "realHours",
        oldValue: task.realHours,
        newValue: newRealHours,
        correctedBy: session.userId,
        correctedAt: nowIso,
      });
      data.realHours = newRealHours;
    }
  }

  if (status !== undefined && status !== task.status) {
    corrections.push({
      taskId: task.id,
      field: "status",
      oldValue: task.status,
      newValue: status,
      correctedBy: session.userId,
      correctedAt: nowIso,
    });
    data.status = status as TaskStatus;
    if (status === "COMPLETADA") {
      data.progress = 100;
      data.completedAt = task.completedAt ?? new Date();
    } else {
      if (status === "PENDIENTE") data.progress = 0;
      data.completedAt = null;
    }
  }

  if (corrections.length === 0) {
    return NextResponse.json({ error: "No hay cambios para guardar" }, { status: 400 });
  }

  data.corrected = true;

  const [yearStr, monthStr] = task.archivedMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const closure = await prisma.monthClosure.findUnique({ where: { month_year: { month, year } } });

  const updated = await prisma.task.update({ where: { id }, data, select: taskSelect });

  if (closure) {
    const existing = Array.isArray(closure.corrections) ? closure.corrections : [];
    await prisma.monthClosure.update({
      where: { id: closure.id },
      data: { corrections: [...existing, ...corrections] },
    });
  } else {
    console.error(`[PATCH /api/tasks/${id}/correct] No se encontró MonthClosure para ${task.archivedMonth}`);
  }

  invalidateAnalyticsCache(task.assignedToId);

  return NextResponse.json(updated);
}
