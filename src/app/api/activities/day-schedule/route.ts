import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { businessCalendarDay, businessDayRealRange } from "@/lib/businessTime";

/** "YYYY-MM-DD" -> Date UTC-medianoche. */
function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Actividades del usuario en sesión, con hora inicio/fin registrada, en
 * cualquier tarea SEGUIMIENTO (no FIJA), para un día dado — usado por el
 * cliente para validar solapamientos de horario antes de guardar. Sin
 * `date`, usa el día calendario de negocio actual.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const dateParam = request.nextUrl.searchParams.get("date");
  const day = dateParam ? parseDateOnly(dateParam) : businessCalendarDay(new Date());
  if (!day) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }

  const { start, end } = businessDayRealRange(day);
  const activities = await prisma.taskActivity.findMany({
    where: {
      authorId: session.userId,
      createdAt: { gte: start, lte: end },
      startTime: { not: null },
      endTime: { not: null },
      task: { type: "SEGUIMIENTO" },
    },
    select: { id: true, startTime: true, endTime: true, taskId: true, task: { select: { title: true } } },
  });

  return NextResponse.json(
    activities.map((a) => ({
      id: a.id,
      startTime: a.startTime,
      endTime: a.endTime,
      taskId: a.taskId,
      taskTitle: a.task.title,
    }))
  );
}
