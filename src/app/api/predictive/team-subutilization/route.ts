import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewTeam, getSubordinateRoles } from "@/lib/roles";
import { cached } from "@/lib/analytics";
import { computeSubutilizacionPredictions } from "@/lib/predictionEngine";

// TTL corto y deliberadamente distinto del default de 15 min: esta caché está
// keyed por líder (session.userId), no por los subordinados cuyos datos
// realmente cambian — invalidateAnalyticsCache(userId) de una tarea/actividad
// de un miembro del equipo NO limpia esta entrada. Ver docs/AUDIT_LOG.md §
// Sprint E (consistencia eventual documentada, no un olvido).
const TEAM_SCAN_TTL_MINUTES = 5;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewTeam(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const now = new Date();
  const subordinateRoles = getSubordinateRoles(session.role);
  const members = await prisma.user.findMany({ where: { role: { in: subordinateRoles } }, select: { id: true, name: true } });
  const userIds = members.map((m) => m.id);

  const { value, fromCache } = await cached(`subutilization-team:${session.userId}`, TEAM_SCAN_TTL_MINUTES, async () => {
    const predictions = await computeSubutilizacionPredictions(userIds, now);
    return members.map((m) => ({ userId: m.id, name: m.name, prediction: predictions.get(m.id) ?? null }));
  });
  return NextResponse.json({ members: value, fromCache });
}
