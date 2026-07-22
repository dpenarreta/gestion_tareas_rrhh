import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getSubordinateRoles, canViewOperationalRisk, isExecutorRole } from "@/lib/roles";
import { computeTeamRecommendations, ANALYTICS_ENGINE_VERSION } from "@/lib/analytics";
import { prioritizeRecommendations } from "@/lib/insightsEngine";

/**
 * Recomendaciones deterministas de redistribución de carga con impacto
 * cuantificado (§S3-A) — motor cruza exceso de horas vs. capacidad
 * disponible del equipo, sin IA. Groq (si se usa en otra vista) solo
 * redactaría este resultado ya calculado, nunca lo calcula.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewOperationalRisk(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  // Roles de liderazgo excluidos de las recomendaciones de redistribución —
  // ni como origen (exceso de horas) ni como destino ("asignarle tareas al
  // Jefe Nacional"): solo colaboradores cuya responsabilidad contempla
  // ejecución de tareas son candidatos válidos (ver Sprint 0A).
  const subordinateRoles = getSubordinateRoles(session.role).filter(isExecutorRole);
  const subordinates = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const recommendations = await computeTeamRecommendations(subordinates);
  const { top, additional } = prioritizeRecommendations(recommendations);

  return NextResponse.json({
    recommendations,
    prioritized: { top, additional },
    engineVersion: ANALYTICS_ENGINE_VERSION,
    lastUpdated: new Date().toISOString(),
  });
}
