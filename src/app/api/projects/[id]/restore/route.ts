import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isProjectManager } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";
import * as recoveryCenter from "@/lib/recoveryCenter";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, responsibleId: true, createdById: true, deletedAt: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!project.deletedAt) {
    return NextResponse.json({ error: "Este proyecto no está en la papelera" }, { status: 409 });
  }
  if (!isProjectManager(session, project)) {
    return NextResponse.json({ error: "No tienes permiso para restaurar este proyecto" }, { status: 403 });
  }

  try {
    await recoveryCenter.restore({ entityType: "PROJECT", entityId: id, userId: session.userId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error al restaurar" }, { status: 409 });
  }

  await logProjectHistory({
    projectId: id,
    actorId: session.userId,
    event: "RESTAURADO",
    description: `${session.name} restauró el proyecto "${project.name}" desde la papelera`,
  });

  return NextResponse.json({ success: true });
}
