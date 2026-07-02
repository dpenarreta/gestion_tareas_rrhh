import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const visibleRoles = getVisibleRoles(session.role);
  const visibleUsers = await prisma.user.findMany({
    where: { role: { in: visibleRoles } },
    select: { id: true },
  });
  const visibleIds = visibleUsers.map((u) => u.id);

  const [closures, archivedTasks] = await Promise.all([
    prisma.monthClosure.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] }),
    prisma.task.findMany({
      where: { assignedToId: { in: visibleIds }, archivedMonth: { not: null } },
      select: { archivedMonth: true, status: true, realHours: true },
    }),
  ]);

  const byMonth = new Map<string, { totalTasks: number; completedTasks: number; totalHours: number }>();
  for (const t of archivedTasks) {
    const key = t.archivedMonth!;
    const cur = byMonth.get(key) ?? { totalTasks: 0, completedTasks: 0, totalHours: 0 };
    cur.totalTasks += 1;
    if (t.status === "COMPLETADA") cur.completedTasks += 1;
    cur.totalHours += t.realHours;
    byMonth.set(key, cur);
  }

  const result = closures
    .map((c) => {
      const key = `${c.year}-${String(c.month).padStart(2, "0")}`;
      const agg = byMonth.get(key);
      if (!agg) return null;
      return {
        year: c.year,
        month: c.month,
        totalTasks: agg.totalTasks,
        completedTasks: agg.completedTasks,
        totalHours: Math.round(agg.totalHours * 100) / 100,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return NextResponse.json(result);
}
