import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewTeam, getSubordinateRoles, isExecutorRole } from "@/lib/roles";
import { computeTeamCapacityForecast } from "@/lib/capacityForecast";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewTeam(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  // Roles de liderazgo excluidos: no se calcula capacidad/horas comprometidas
  // individuales para quien dirige, no ejecuta (ver Sprint 0A).
  const subordinateRoles = getSubordinateRoles(session.role).filter(isExecutorRole);
  const subordinates = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  if (subordinates.length === 0) {
    return NextResponse.json({ members: [], summary: { total: 0, alta: 0, limitada: 0, sobrecargados: 0, sinPlanificacion: 0 } });
  }

  const forecasts = await computeTeamCapacityForecast(subordinates.map((s) => s.id));

  const members = subordinates.map((s) => {
    const f = forecasts.get(s.id)!;
    return { id: s.id, name: s.name, role: s.role, ...f };
  });

  const summary = {
    total: members.length,
    alta: members.filter((m) => m.estado === "alta").length,
    limitada: members.filter((m) => m.estado === "limitada").length,
    sobrecargados: members.filter((m) => m.estadoColor === "red").length,
    sinPlanificacion: members.filter((m) => m.estado === "sin-planificacion").length,
  };

  return NextResponse.json({ members, summary });
}
