import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageKnowledgeBase } from "@/lib/roles";
import { deleteFromGithub } from "@/lib/githubDocuments";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageKnowledgeBase(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

  if (doc.githubPath && doc.githubSha) {
    await deleteFromGithub(doc.githubPath, doc.githubSha).catch((err) => {
      console.error(`[DELETE /api/assistant/documents/${id}] fallo eliminando de GitHub:`, err);
    });
  }

  await prisma.knowledgeDocument.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
