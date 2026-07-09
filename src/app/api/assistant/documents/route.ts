import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageKnowledgeBase } from "@/lib/roles";
import { extractDriveFileId, processDriveDocument } from "@/lib/driveDocuments";

export const maxDuration = 60;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const docs = await prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, fileName: true, driveUrl: true, createdAt: true, status: true, processingError: true,
      uploadedBy: { select: { name: true } },
      _count: { select: { chunks: true } },
    },
  });
  return NextResponse.json(docs);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageKnowledgeBase(session.role)) {
    return NextResponse.json({ error: "Sin permisos para agregar documentos" }, { status: 403 });
  }

  let body: { title?: string; driveUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const title = body.title?.trim();
  const driveUrl = body.driveUrl?.trim();
  if (!title) return NextResponse.json({ error: "Nombre del documento requerido" }, { status: 400 });
  if (!driveUrl) return NextResponse.json({ error: "Link de Google Drive requerido" }, { status: 400 });

  const driveFileId = extractDriveFileId(driveUrl);
  if (!driveFileId) {
    return NextResponse.json(
      { error: "No se pudo interpretar el link de Google Drive. Verifica que sea un link de visualización válido." },
      { status: 400 }
    );
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      title,
      fileName: title,
      driveUrl,
      driveFileId,
      status: "PROCESANDO",
      uploadedById: session.userId,
    },
    select: {
      id: true, title: true, fileName: true, createdAt: true, status: true, processingError: true,
      _count: { select: { chunks: true } },
    },
  });

  await processDriveDocument(doc.id, driveFileId);

  const processed = await prisma.knowledgeDocument.findUnique({
    where: { id: doc.id },
    select: {
      id: true, title: true, fileName: true, createdAt: true, status: true, processingError: true,
      _count: { select: { chunks: true } },
    },
  });

  return NextResponse.json(processed, { status: 201 });
}
