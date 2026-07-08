import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { getEmbedding } from "@/lib/embeddings";

// Vercel (plan gratuito) rechaza el request completo por encima de 4.5MB antes
// de que este handler se ejecute, así que validamos con el mismo margen para
// poder devolver un mensaje claro en vez de dejar que la plataforma corte la conexión.
const MAX_SIZE_BYTES = 4.5 * 1024 * 1024;
const MAX_SIZE_MESSAGE = "El archivo supera el límite de 4.5MB. Por favor usa un archivo más pequeño.";

export const maxDuration = 60;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function chunkText(
  pages: Array<{ text: string; pageNumber: number }>,
  chunkSize = 1800,
  overlap = 200
): Array<{ content: string; pageNumber: number; chunkIndex: number }> {
  const chunks: Array<{ content: string; pageNumber: number; chunkIndex: number }> = [];
  let chunkIndex = 0;

  for (const { text, pageNumber } of pages) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 80) continue;

    let start = 0;
    while (start < clean.length) {
      const end = Math.min(start + chunkSize, clean.length);
      const content = clean.slice(start, end).trim();
      if (content.length > 80) {
        chunks.push({ content, pageNumber, chunkIndex: chunkIndex++ });
      }
      if (end === clean.length) break;
      start += chunkSize - overlap;
    }
  }
  return chunks;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const docs = await prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, fileName: true, createdAt: true, processingError: true,
      uploadedBy: { select: { name: true } },
      _count: { select: { chunks: true } },
    },
  });
  return NextResponse.json(docs);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos para subir documentos" }, { status: 403 });
  }

  // Rechazo temprano por Content-Length antes de bufferizar el body completo.
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
  if (!title) return NextResponse.json({ error: "Título requerido" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: MAX_SIZE_MESSAGE }, { status: 413 });
  }
  const isPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  const isPdfMimeType = !file.type || file.type === "application/pdf";
  if (!isPdfExtension || !isPdfMimeType) {
    return NextResponse.json({ error: "Solo se aceptan archivos PDF" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // El documento se guarda SIEMPRE (con el PDF crudo) aunque el
    // procesamiento (extracción de texto / embeddings) falle — así una
    // falla del pipeline de IA no bloquea la subida. `processingError`
    // queda registrado para que el admin sepa que ese documento todavía
    // no es buscable por Nova y pueda reintentar más tarde.
    let processingError: string | null = null;
    let chunksToCreate: Array<{ content: string; embedding: number[]; pageNumber: number; chunkIndex: number }> = [];

    // 1) Extraer texto por página. pdf-parse v2 usa una API basada en clase
    // (new PDFParse().getText()), no la vieja API de función v1 con callback
    // `pagerender`.
    let pageTexts: Array<{ text: string; pageNumber: number }> = [];
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      pageTexts = result.pages.map((p) => ({ text: p.text, pageNumber: p.num }));
    } catch (err) {
      console.error("[POST /api/assistant/documents] Error al parsear el PDF:", err);
      processingError = `No se pudo extraer texto del PDF: ${errorMessage(err)}`;
    } finally {
      await parser.destroy().catch((err) => {
        console.error("[POST /api/assistant/documents] Error al liberar el parser de PDF:", err);
      });
    }

    // 2) Chunkear y generar embeddings, solo si la extracción de texto sirvió.
    if (!processingError) {
      const chunks = chunkText(pageTexts);
      if (chunks.length === 0) {
        processingError = "El PDF no tiene contenido de texto suficiente para indexar.";
      } else {
        try {
          const embeddings = await Promise.all(chunks.map((c) => getEmbedding(c.content)));
          chunksToCreate = chunks.map((chunk, i) => ({
            content: chunk.content,
            embedding: embeddings[i],
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
          }));
        } catch (err) {
          console.error("[POST /api/assistant/documents] Error al generar embeddings:", err);
          processingError = `No se pudieron generar los embeddings: ${errorMessage(err)}`;
        }
      }
    }

    // 3) Guardar el documento (siempre incluye el PDF crudo en fileData).
    let doc;
    try {
      doc = await prisma.knowledgeDocument.create({
        data: {
          title,
          fileName: file.name,
          fileData: buffer,
          processingError,
          uploadedById: session.userId,
          chunks: chunksToCreate.length > 0 ? { create: chunksToCreate } : undefined,
        },
        select: {
          id: true, title: true, fileName: true, createdAt: true, processingError: true,
          _count: { select: { chunks: true } },
        },
      });
    } catch (err) {
      console.error("[POST /api/assistant/documents] Error al guardar el documento en la base de datos:", err);
      return NextResponse.json({ error: "Error al guardar el documento" }, { status: 500 });
    }

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("[POST /api/assistant/documents] Error inesperado:", err);
    return NextResponse.json(
      { error: `Error inesperado al procesar el documento: ${errorMessage(err)}` },
      { status: 500 }
    );
  }
}
