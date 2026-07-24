import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/lib/session";
import { businessCalendarDay } from "@/lib/businessTime";
import { findOverlappingActivity, overlapMessage } from "@/lib/activityOverlap";
import { timeToMinutes } from "@/lib/timeOverlap";
import { invalidateAnalyticsCache } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

const activitySelect = {
  id: true,
  reason: true,
  startTime: true,
  endTime: true,
  duration: true,
  description: true,
  isRetroactive: true,
  activityDate: true,
  adminComment: true,
  modifiedByAdmin: true,
  modifiedAt: true,
  author: { select: { id: true, name: true } },
  createdAt: true,
  _count: { select: { comments: true } },
} as const;

async function recalcRealHours(taskId: string) {
  const activities = await prisma.taskActivity.findMany({
    where: { taskId },
    select: { duration: true },
  });
  const totalMins = activities.reduce((sum, a) => sum + a.duration, 0);
  await prisma.task.update({
    where: { id: taskId },
    data: { realHours: Math.round((totalMins / 60) * 100) / 100 },
  });
}

// Máximo de registros permitidos para una tarea Fija — ver
// MIGRATION_REASON_KEY más abajo para el registro migrado que ocupa el
// primer cupo cuando existe historial previo.
const FIJA_MAX_ACTIVITIES = 2;
export const FIJA_MAX_ACTIVITIES_MESSAGE =
  "Esta tarea fija ya alcanzó el número máximo de registros permitidos.";

// Sprint "Estandarización de registro de actividades" (§1/§4/§5): las tareas
// Fijas nunca registraron actividades — solo un valor suelto en
// Task.realHours, editado a mano, sin historial ni auditoría. Al unificar el
// modelo de registro con Seguimiento, una tarea Fija con horas reales
// preexistentes pero SIN ninguna actividad debe conservar esa información
// como una actividad histórica, no perderla.
const MIGRATION_REASON_KEY = "migracion_automatica_registro_historico";
const MIGRATION_ACTIVITY_DESCRIPTION =
  "Actividad creada automáticamente durante la estandarización del sistema para conservar el historial.";

/**
 * Migración perezosa e idempotente (§5): se ejecuta solo la primera vez que
 * se listan las actividades de una tarea Fija con `realHours > 0` y cero
 * actividades — deja de aplicar apenas exista alguna (incluida ella misma).
 * No se modifica el schema de Prisma: el "indicador interno
 * esMigracionAutomatica" pedido por el sprint es, en la práctica, esta clave
 * de motivo dedicada (nunca asignada a ningún rol, por lo que
 * `selectableReasons()` la excluye siempre del formulario de registro) — es
 * consultable para auditoría vía `TaskActivity.reason`, sin necesitar una
 * columna nueva. Deliberadamente NO se corrió como script masivo contra la
 * base compartida (ver feedback de sesiones anteriores sobre el riesgo de
 * escrituras globales en la BD de producción) — se autocompleta sola, tarea
 * por tarea, a medida que alguien abre su panel de actividades.
 */
async function migrateFijaHistoryIfNeeded(task: {
  id: string;
  type: string;
  realHours: number;
  assignedToId: string;
  completedAt: Date | null;
  updatedAt: Date;
}) {
  if (task.type !== "FIJA" || task.realHours <= 0) return;

  // Corrección 2026-07-24 (ver docs/AUDIT_LOG.md § auditoría de
  // registros retroactivos): el "count() luego create()" original tenía una
  // ventana teórica de condición de carrera — dos GET /activities
  // concurrentes para la misma tarea podían leer existingCount=0 antes de
  // que cualquiera de las dos terminara de escribir, y ambas crear su
  // propia actividad migrada (duplicando esas horas). Nunca se observó en
  // los datos de producción auditados, pero se cierra el hueco igual:
  // check + create ahora corren dentro de UNA transacción Serializable —
  // Postgres garantiza que, si dos transacciones concurrentes intentan lo
  // mismo, una de las dos falla por conflicto de serialización en vez de
  // que ambas tengan éxito. La transacción perdedora simplemente no crea
  // nada (la otra ya lo hizo) — se captura el error y se ignora, sin
  // romper la carga normal de actividades por un efecto secundario de
  // idempotencia que de todas formas se volverá a intentar en la próxima
  // apertura del panel.
  try {
    await prisma.$transaction(
      async (tx) => {
        const existingCount = await tx.taskActivity.count({ where: { taskId: task.id } });
        if (existingCount > 0) return;

        await tx.activityReason.upsert({
          where: { key: MIGRATION_REASON_KEY },
          update: {},
          create: {
            key: MIGRATION_REASON_KEY,
            label: "Registro migrado automáticamente",
            description: "Motivo interno usado por la migración automática de historial de tareas Fijas — no asignar a roles ni usar en registros nuevos.",
            isActive: true,
            // Sin roles asignados: selectableReasons() lo excluye siempre del
            // selector de "Motivo" para actividades nuevas.
            assignedRoles: [],
          },
        });

        const activityDate = task.completedAt ?? task.updatedAt;
        await tx.taskActivity.create({
          data: {
            taskId: task.id,
            authorId: task.assignedToId,
            reason: MIGRATION_REASON_KEY,
            duration: Math.round(task.realHours * 60),
            description: MIGRATION_ACTIVITY_DESCRIPTION,
            isRetroactive: true,
            activityDate,
            createdAt: activityDate,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    console.error(`migrateFijaHistoryIfNeeded: se omitió por conflicto de concurrencia (taskId=${task.id})`, err);
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;

    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, type: true, realHours: true, assignedToId: true, completedAt: true, updatedAt: true },
    });
    if (task) await migrateFijaHistoryIfNeeded(task);

    const activities = await prisma.taskActivity.findMany({
      where: { taskId: id },
      select: activitySelect,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(activities);
  } catch (err) {
    console.error("GET /activities error:", err);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id: taskId } = await ctx.params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
    }

    const { reason, hours, minutes, description, startTime, endTime } = body as {
      reason?: string;
      hours?: number;
      minutes?: number;
      description?: string;
      startTime?: string;
      endTime?: string;
    };

    if (!reason || hours === undefined || minutes === undefined) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const reasonRow = await prisma.activityReason.findUnique({ where: { key: reason } });
    if (!reasonRow || !reasonRow.isActive || !reasonRow.assignedRoles.includes(session.role)) {
      return NextResponse.json({ error: "Motivo inválido o no disponible para tu rol" }, { status: 400 });
    }

    if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
      return NextResponse.json({ error: "Las horas deben ser un número entre 0 y 23" }, { status: 400 });
    }

    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      return NextResponse.json({ error: "Los minutos deben ser un número entre 0 y 59" }, { status: 400 });
    }

    const duration = hours * 60 + minutes;

    if (duration <= 0) {
      return NextResponse.json(
        { error: "La duración debe ser mayor a 0" },
        { status: 400 }
      );
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    // Tareas Fijas: máximo 2 registros (§4) — el primero suele ser el
    // registro migrado automáticamente (§5) cuando ya existía historial, y el
    // segundo queda reservado para correcciones/complementos/ajustes finales.
    if (task.type === "FIJA") {
      const existingCount = await prisma.taskActivity.count({ where: { taskId } });
      if (existingCount >= FIJA_MAX_ACTIVITIES) {
        return NextResponse.json({ error: FIJA_MAX_ACTIVITIES_MESSAGE }, { status: 409 });
      }
    }

    // El validador de solapamiento solo aplica cuando se usa el formato
    // hora inicio/hora fin (típicamente Seguimiento; nada impide que una
    // tarea Fija también lo use si su actividad se registra con ese formato).
    if (startTime && endTime) {
      if (timeToMinutes(startTime) === null || timeToMinutes(endTime) === null) {
        return NextResponse.json({ error: "Hora inválida" }, { status: 400 });
      }
      if (timeToMinutes(endTime)! <= timeToMinutes(startTime)!) {
        return NextResponse.json({ error: "La hora fin debe ser posterior a la hora inicio" }, { status: 400 });
      }
      const today = businessCalendarDay(new Date());
      const conflict = await findOverlappingActivity(session.userId, today, startTime, endTime);
      if (conflict) {
        return NextResponse.json({ error: overlapMessage(conflict), conflict }, { status: 409 });
      }
    }

    const activity = await prisma.taskActivity.create({
      data: {
        taskId,
        authorId: session.userId,
        reason,
        duration,
        description: description?.trim() || null,
        startTime: startTime || null,
        endTime: endTime || null,
      },
      select: activitySelect,
    });

    await recalcRealHours(taskId);
    invalidateAnalyticsCache(task.assignedToId);

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    console.error("POST /activities error:", err);
    return NextResponse.json({ error: "Error interno al registrar actividad" }, { status: 500 });
  }
}
