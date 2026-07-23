import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject, isProjectParticipant } from "@/lib/projectAccess";
import { logProjectHistory } from "@/lib/projectHistory";
import type { ProjectDocumentCategory } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

// Mismo límite que el adjunto de Mejora Continua (§Vercel: cuerpos grandes en
// base64 fallan silenciosamente en producción) — ~4.5MB de binario.
const MAX_BASE64_LENGTH = 6_000_000;

const documentSelect = {
  id: true,
  category: true,
  fileName: true,
  mimeType: true,
  version: true,
  previousVersionId: true,
  activityId: true,
  uploadedBy: { select: { id: true, name: true } },
  createdAt: true,
} as const;

async function loadProjectForAccess(id: string) {
  return prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      responsibleId: true,
      createdById: true,
      participants: { select: { userId: true } },
    },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canViewProject(session, project, project.participants.map((p) => p.userId))) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }

  const documents = await prisma.projectDocument.findMany({
    where: { projectId },
    select: documentSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(documents);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const participantIds = project.participants.map((p) => p.userId);
  if (!isProjectParticipant(session, project, participantIds)) {
    return NextResponse.json({ error: "Solo los participantes del proyecto pueden subir documentos" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { fileName, mimeType, fileData, category, activityId, previousVersionId } = body as {
    fileName?: string;
    mimeType?: string;
    fileData?: string;
    category?: ProjectDocumentCategory;
    activityId?: string;
    previousVersionId?: string;
  };

  if (!fileName?.trim() || !fileData) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (fileData.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "El archivo es demasiado grande (máximo ~4.5MB)" }, { status: 413 });
  }

  if (activityId) {
    const activity = await prisma.projectActivity.findUnique({ where: { id: activityId } });
    if (!activity || activity.projectId !== projectId) {
      return NextResponse.json({ error: "Actividad inválida" }, { status: 400 });
    }
  }

  let version = 1;
  if (previousVersionId) {
    const previous = await prisma.projectDocument.findUnique({ where: { id: previousVersionId } });
    if (!previous || previous.projectId !== projectId) {
      return NextResponse.json({ error: "Versión anterior inválida" }, { status: 400 });
    }
    version = previous.version + 1;
  }

  const document = await prisma.projectDocument.create({
    data: {
      projectId,
      activityId: activityId || null,
      category: category ?? "OTRO",
      fileName: fileName.trim(),
      mimeType: mimeType || null,
      fileData,
      version,
      previousVersionId: previousVersionId || null,
      uploadedById: session.userId,
    },
    select: documentSelect,
  });

  await logProjectHistory({
    projectId,
    actorId: session.userId,
    event: "DOCUMENTO_AGREGADO",
    description: `${session.name} subió el documento "${document.fileName}"${version > 1 ? ` (v${version})` : ""} a "${project.name}"`,
    newValue: { documentId: document.id, fileName: document.fileName, version },
  });

  return NextResponse.json(document, { status: 201 });
}
