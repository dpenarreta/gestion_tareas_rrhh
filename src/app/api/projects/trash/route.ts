import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canCreateProject, ROLE_LEVEL } from "@/lib/roles";
import * as recoveryCenter from "@/lib/recoveryCenter";

const trashSelect = {
  id: true,
  name: true,
  status: true,
  responsible: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  deletedAt: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canCreateProject(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Barrido perezoso: nunca se ejecuta como script masivo aparte, se dispara
  // cada vez que alguien abre la Papelera (ver src/lib/recoveryCenter.ts).
  await recoveryCenter.purgeExpiredItems();

  const isLeadership = ROLE_LEVEL[session.role] >= 3;

  const projects = await prisma.project.findMany({
    where: {
      deletedAt: { not: null },
      ...(isLeadership ? {} : { OR: [{ responsibleId: session.userId }, { createdById: session.userId }] }),
    },
    select: trashSelect,
    orderBy: { deletedAt: "desc" },
  });

  const withRetention = await Promise.all(
    projects.map(async (p) => {
      const retention = await recoveryCenter.getRemainingRetentionTime("PROJECT", p.id);
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        responsible: p.responsible,
        createdBy: p.createdBy,
        deletedAt: p.deletedAt,
        expiresAt: retention?.expiresAt ?? null,
        msRemaining: retention?.msRemaining ?? 0,
      };
    })
  );

  return NextResponse.json(withRetention);
}
