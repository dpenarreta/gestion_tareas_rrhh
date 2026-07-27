import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject } from "@/lib/projectAccess";
import { cached } from "@/lib/analytics";
import { computeProjectDelayPrediction } from "@/lib/predictionEngine";

type Ctx = { params: Promise<{ projectId: string }> };

// Mismo TTL corto que team-subutilization — cache keyed por projectId, sin
// invalidación al cambiar tareas/actividades de sus participantes (ver
// docs/AUDIT_LOG.md § Sprint E).
const PROJECT_DELAY_TTL_MINUTES = 5;

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { projectId } = await ctx.params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { responsibleId: true, createdById: true, participants: { select: { userId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  const participantUserIds = project.participants.map((p) => p.userId);
  if (!canViewProject(session, project, participantUserIds)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const now = new Date();
  const { value, fromCache } = await cached(`project-delay:${projectId}`, PROJECT_DELAY_TTL_MINUTES, () => computeProjectDelayPrediction(projectId, now));
  return NextResponse.json({ ...value, fromCache });
}
