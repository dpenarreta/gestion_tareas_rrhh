import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectDocumentListItemToNexoShape,
  type DjangoProjectDocumentListItem,
} from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django. El límite de tamaño (413) ya lo
// valida `ProjectViewSet.documents` en Django con el mismo literal
// `MAX_BASE64_LENGTH = 6_000_000` — no hace falta repetir el chequeo acá.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${projectId}/documents/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron obtener los documentos" }, { status: 400 });
  }

  const documents: DjangoProjectDocumentListItem[] = await response.json();
  return NextResponse.json(documents.map(mapDjangoProjectDocumentListItemToNexoShape));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { fileName, mimeType, fileData, category, activityId, previousVersionId } = body as {
    fileName?: string;
    mimeType?: string;
    fileData?: string;
    category?: string;
    activityId?: string;
    previousVersionId?: string;
  };

  const response = await djangoApiFetch(`/projects/${projectId}/documents/`, {
    method: "POST",
    body: JSON.stringify({
      file_name: fileName,
      mime_type: mimeType ?? "",
      file_data: fileData,
      category: category ?? undefined,
      activity: activityId ? Number(activityId) : null,
      previous_version_id: previousVersionId ? Number(previousVersionId) : null,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Solo los participantes del proyecto pueden subir documentos" }, { status: 403 });
  }
  if (response.status === 413) {
    return NextResponse.json({ error: "El archivo es demasiado grande (máximo ~4.5MB)" }, { status: 413 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "Faltan campos requeridos");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const document: DjangoProjectDocumentListItem = await response.json();
  return NextResponse.json(mapDjangoProjectDocumentListItemToNexoShape(document), { status: 201 });
}
