import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoProjectDocumentDetailToNexoShape, type DjangoProjectDocumentDetail } from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, documentId } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${projectId}/documents/${documentId}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener el documento" }, { status: 400 });
  }

  const document: DjangoProjectDocumentDetail = await response.json();
  return NextResponse.json({ ...mapDjangoProjectDocumentDetailToNexoShape(document), projectId });
}
