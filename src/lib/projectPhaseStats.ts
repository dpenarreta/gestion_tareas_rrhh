import "server-only";
import { prisma } from "@/lib/prisma";

type PhaseBase = { id: string };
type PhaseParticipant = { id: string; name: string };

export type PhaseStats = {
  registeredMinutes: number;
  participants: PhaseParticipant[];
};

/**
 * Sprint 2.1 §4/§5: "participantes de una fase" no es una relación propia en
 * el schema (solo existe `responsibleId`, un único responsable) — se deriva
 * de quién registró al menos una actividad en esa fase, igual criterio que
 * "participante de proyecto" (§2: se es participante por asignación
 * explícita o por registrar actividad). Evita una migración de schema para
 * un dato puramente derivado/de lectura.
 */
export async function getPhaseStats(projectId: string, phases: PhaseBase[]): Promise<Map<string, PhaseStats>> {
  const activities = await prisma.projectActivity.findMany({
    where: { projectId, phaseId: { not: null } },
    select: { phaseId: true, duration: true, author: { select: { id: true, name: true } } },
  });

  const byPhase = new Map<string, { minutes: number; participants: Map<string, string> }>();
  for (const a of activities) {
    if (!a.phaseId) continue;
    const entry = byPhase.get(a.phaseId) ?? { minutes: 0, participants: new Map<string, string>() };
    entry.minutes += a.duration;
    entry.participants.set(a.author.id, a.author.name);
    byPhase.set(a.phaseId, entry);
  }

  const result = new Map<string, PhaseStats>();
  for (const phase of phases) {
    const stat = byPhase.get(phase.id);
    result.set(phase.id, {
      registeredMinutes: stat?.minutes ?? 0,
      participants: stat ? Array.from(stat.participants, ([id, name]) => ({ id, name })) : [],
    });
  }
  return result;
}

export async function getLastActivity(projectId: string): Promise<{ authorName: string; createdAt: Date } | null> {
  const last = await prisma.projectActivity.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, author: { select: { name: true } } },
  });
  return last ? { authorName: last.author.name, createdAt: last.createdAt } : null;
}
