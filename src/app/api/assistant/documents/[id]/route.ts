import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageKnowledgeBase } from "@/lib/roles";
import { deleteFromGithub } from "@/lib/githubDocuments";
import { deleteDjangoKnowledgeDocument, fetchDjangoKnowledgeDocument } from "@/lib/djangoAssistantAdapter";

type Ctx = { params: Promise<{ id: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 58): esta ruta
// pasó de Prisma a Django (`apps.assistant`). El borrado del archivo en
// GitHub lo sigue haciendo Next.js antes de llamar a Django, sin cambios.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageKnowledgeBase(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const doc = await fetchDjangoKnowledgeDocument(id);
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

  if (doc.github_path && doc.github_sha) {
    await deleteFromGithub(doc.github_path, doc.github_sha).catch((err) => {
      console.error(`[DELETE /api/assistant/documents/${id}] fallo eliminando de GitHub:`, err);
    });
  }

  const ok = await deleteDjangoKnowledgeDocument(id);
  if (!ok) return NextResponse.json({ error: "No se pudo eliminar el documento" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
