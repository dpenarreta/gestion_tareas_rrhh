import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewTeam, getSubordinateRoles, ROLE_LEVEL } from "@/lib/roles";
import { cached } from "@/lib/analytics";
import { computeTeamPreventiveAlerts } from "@/lib/preventiveIntelligence";

const TEAM_SCAN_TTL_MINUTES = 5;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewTeam(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const subordinateRoles = getSubordinateRoles(session.role);
  const members = await prisma.user.findMany({ where: { role: { in: subordinateRoles } }, select: { id: true } });
  const userIds = members.map((m) => m.id);

  // Nivel >= 3 (mismo umbral que canViewProject) ve todos los proyectos
  // activos; el resto solo los propios (responsable/creador/participante,
  // propio o de un subordinado directo) — mismo criterio que projectAccess.ts,
  // extendido aquí a una lista en vez de un proyecto puntual.
  const isLeadershipWide = ROLE_LEVEL[session.role] >= 3;
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["COMPLETADO", "CANCELADO"] },
      ...(isLeadershipWide
        ? {}
        : {
            OR: [
              { responsibleId: session.userId },
              { createdById: session.userId },
              { participants: { some: { userId: { in: [session.userId, ...userIds] } } } },
            ],
          }),
    },
    select: { id: true },
  });

  const now = new Date();
  const { value, fromCache } = await cached(`team-preventive-alerts:${session.userId}`, TEAM_SCAN_TTL_MINUTES, () =>
    computeTeamPreventiveAlerts(
      userIds,
      projects.map((p) => p.id),
      now
    )
  );
  return NextResponse.json({ alerts: value, fromCache });
}
