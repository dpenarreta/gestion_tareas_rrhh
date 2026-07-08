import { prisma } from "@/lib/prisma";
import { ROLE_LEVEL, getVisibleRoles } from "@/lib/roles";
import type { SessionPayload } from "@/lib/session";
import type { IdeaStatus } from "@/generated/prisma/client";

export async function getVisibleIdeaAuthorIds(session: SessionPayload): Promise<string[]> {
  if (ROLE_LEVEL[session.role] === 1) {
    return [session.userId];
  }

  // Mejora Continua es una excepción a la regla general de jerarquía: el
  // Coordinador Nacional sí ve las ideas del Jefe Nacional (a diferencia de
  // KPIs/Analytics/Informes, donde esa visibilidad está restringida).
  if (session.role === "JEFE_NACIONAL" || session.role === "COORDINADOR_NACIONAL") {
    // El Administrador es invisible para el resto de roles, incluso en esta excepción.
    const allUsers = await prisma.user.findMany({
      where: { role: { not: "ADMINISTRADOR" } },
      select: { id: true },
    });
    return allUsers.map((u) => u.id);
  }

  const visibleRoles = getVisibleRoles(session.role);
  const visibleUsers = await prisma.user.findMany({
    where: { role: { in: visibleRoles } },
    select: { id: true },
  });
  return visibleUsers.map((u) => u.id);
}

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  PROPUESTA: "Propuesta",
  EN_REVISION: "En revisión",
  APROBADA: "Aprobada",
  EN_DESARROLLO: "En desarrollo",
  EN_PRUEBAS: "En pruebas",
  IMPLEMENTADA: "Implementada",
  RECHAZADA: "Rechazada",
};

export const IDEA_STATUS_ORDER: IdeaStatus[] = [
  "PROPUESTA",
  "EN_REVISION",
  "APROBADA",
  "EN_DESARROLLO",
  "EN_PRUEBAS",
  "IMPLEMENTADA",
];

export function nextIdeaStatus(current: IdeaStatus): IdeaStatus | null {
  const idx = IDEA_STATUS_ORDER.indexOf(current);
  if (idx === -1 || idx === IDEA_STATUS_ORDER.length - 1) return null;
  return IDEA_STATUS_ORDER[idx + 1];
}

export function prevIdeaStatus(current: IdeaStatus): IdeaStatus | null {
  const idx = IDEA_STATUS_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return IDEA_STATUS_ORDER[idx - 1];
}

export function canReject(current: IdeaStatus): boolean {
  return current !== "IMPLEMENTADA" && current !== "RECHAZADA";
}
