import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageKnowledgeBase } from "@/lib/roles";
import { uploadPdfToGithub, processGithubDocument } from "@/lib/githubDocuments";

// Documentos grandes (cientos de páginas → cientos de chunks) pueden tardar
// más que el límite por defecto en generar todos los embeddings, incluso en
// lotes concurrentes — se sube el máximo para no truncar el procesamiento.
export const maxDuration = 300;

// Vercel (plan gratuito) rechaza el request completo por encima de 4.5MB antes
// de que este handler se ejecute, así que validamos con el mismo margen para
// poder devolver un mensaje claro en vez de dejar que la plataforma corte la conexión.
const MAX_SIZE_BYTES = 4.5 * 1024 * 1024;
const MAX_SIZE_MESSAGE = "El archivo supera el límite de 4.5MB. Por favor usa un archivo más pequeño.";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const docs = await prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, fileName: true, githubPath: true, createdAt: true, status: true, processingError: true,
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

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: MAX_SIZE_MESSAGE }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[POST /api/assistant/documents] Error al parsear formData:", err);
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null)?.trim();
  if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Nombre del documento requerido" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: MAX_SIZE_MESSAGE }, { status: 413 });
  }
  const isPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  const isPdfMimeType = !file.type || file.type === "application/pdf";
  if (!isPdfExtension || !isPdfMimeType) {
    return NextResponse.json({ error: "Solo se aceptan archivos PDF" }, { status: 400 });
  }

  // Cualquier excepción no prevista de aquí en adelante se captura y se
  // devuelve como JSON — de lo contrario Next.js entrega una página de error
  // HTML y el cliente, al intentar parsearla como JSON, muestra un genérico
  // "Error de conexión" sin pista alguna de la causa real.
  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const doc = await prisma.knowledgeDocument.create({
      data: {
        title,
        fileName: file.name,
        status: "PROCESANDO",
        uploadedById: session.userId,
      },
      select: { id: true },
    });

    let githubInfo: { path: string; sha: string };
    try {
      githubInfo = await uploadPdfToGithub(doc.id, file.name, buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[POST /api/assistant/documents] documento ${doc.id}: subida a GitHub falló:`, err);
      await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "ERROR", processingError: message } });
      const failed = await prisma.knowledgeDocument.findUnique({
        where: { id: doc.id },
        select: {
          id: true, title: true, fileName: true, githubPath: true, createdAt: true, status: true, processingError: true,
          _count: { select: { chunks: true } },
        },
      });
      return NextResponse.json(failed, { status: 201 });
    }

    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { githubPath: githubInfo.path, githubSha: githubInfo.sha },
    });

    await processGithubDocument(doc.id, githubInfo.path, githubInfo.sha);

    const processed = await prisma.knowledgeDocument.findUnique({
      where: { id: doc.id },
      select: {
        id: true, title: true, fileName: true, githubPath: true, createdAt: true, status: true, processingError: true,
        _count: { select: { chunks: true } },
      },
    });

    return NextResponse.json(processed, { status: 201 });
  } catch (err) {
    console.error("[POST /api/assistant/documents] error inesperado:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Error al agregar el documento: ${message}` }, { status: 500 });
  }
}
