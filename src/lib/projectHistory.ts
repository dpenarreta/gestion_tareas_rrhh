import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { ProjectHistoryEvent } from "@/generated/prisma/client";

/**
 * Bitácora de auditoría del módulo Proyectos (§9/§14) — un registro por
 * evento relevante, nunca editado ni eliminado. Se llama desde cada ruta que
 * muta un proyecto (creación, cambio de estado/responsable, altas de fase,
 * participante, comentario, actividad o documento).
 */
export async function logProjectHistory(params: {
  projectId: string;
  actorId: string;
  event: ProjectHistoryEvent;
  description: string;
  previousValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
}) {
  const { projectId, actorId, event, description, previousValue, newValue } = params;
  await prisma.projectHistory.create({
    data: {
      projectId,
      actorId,
      event,
      description,
      previousValue: previousValue === null ? Prisma.JsonNull : previousValue,
      newValue: newValue === null ? Prisma.JsonNull : newValue,
    },
  });
}
