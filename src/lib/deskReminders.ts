import "server-only";
import { prisma } from "@/lib/prisma";
import { businessCalendarDay, businessDayRealRange } from "@/lib/businessTime";
import type { ReminderRepeat } from "@/generated/prisma/client";

/** Rango [inicio, fin] del día calendario "hoy" en el huso horario de negocio (UTC-5, ver businessTime.ts). */
export function todayRange(): { start: Date; end: Date } {
  return businessDayRealRange(businessCalendarDay(new Date()));
}

/** Próxima ocurrencia de un recordatorio repetitivo — conserva hora/minuto, avanza el día calendario en UTC. */
export function advanceRepeat(dueAt: Date, repeat: ReminderRepeat): Date {
  const next = new Date(dueAt);
  switch (repeat) {
    case "DIARIO":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "SEMANAL":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "MENSUAL":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "UNA_VEZ":
    default:
      break;
  }
  return next;
}

/**
 * Barrido perezoso (mismo criterio que purgeExpiredItems en recoveryCenter.ts
 * y la migración de historial de Fijas): en vez de un cron dedicado, cada vez
 * que el usuario consulta sus recordatorios se revisa si algo venció desde la
 * última vez y, de ser así, se genera UNA notificación in-app reutilizando el
 * modelo Notification existente (§15 del pedido) — nunca más de una por
 * vencimiento, gracias a la bandera `notified`.
 */
export async function notifyDueReminders(userId: string): Promise<void> {
  const now = new Date();
  const due = await prisma.personalReminder.findMany({
    where: { userId, status: "PENDIENTE", notified: false, dueAt: { lte: now } },
    select: { id: true, title: true },
  });
  if (due.length === 0) return;

  await prisma.$transaction([
    prisma.personalReminder.updateMany({
      where: { id: { in: due.map((r) => r.id) } },
      data: { notified: true },
    }),
    prisma.notification.createMany({
      data: due.map((r) => ({
        userId,
        message: `Recordatorio: "${r.title}"`,
      })),
    }),
  ]);
}
