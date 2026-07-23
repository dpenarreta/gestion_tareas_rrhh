import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isProjectCreator } from "@/lib/projectAccess";
import * as recoveryCenter from "@/lib/recoveryCenter";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Elimina definitivamente un proyecto que ya está en la papelera. A
 * diferencia de DELETE /api/projects/[id] (mover a la papelera), esta acción
 * es irreversible — borra la fila física (cascada sobre fases, participantes,
 * actividades, comentarios, documentos e historial del proyecto). El registro
 * de auditoría sobrevive en RecoveryAuditLog (referencia suelta, sin FK).
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsibleId: true, createdById: true, deletedAt: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!project.deletedAt) {
    return NextResponse.json({ error: "Este proyecto no está en la papelera" }, { status: 409 });
  }
  if (!isProjectCreator(session, project)) {
    return NextResponse.json({ error: "Solo el creador del proyecto puede eliminarlo definitivamente" }, { status: 403 });
  }

  try {
    await recoveryCenter.deletePermanently({ entityType: "PROJECT", entityId: id, userId: session.userId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error al eliminar definitivamente" }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
