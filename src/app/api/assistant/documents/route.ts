import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { getEmbedding } from "@/lib/embeddings";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

interface PdfPageData {
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

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
      id: true, title: true, fileName: true, createdAt: true,
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null)?.trim();
  if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Título requerido" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el tamaño máximo permitido (10MB)" }, { status: 400 });
  }
  const isPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  const isPdfMimeType = !file.type || file.type === "application/pdf";
  if (!isPdfExtension || !isPdfMimeType) {
    return NextResponse.json({ error: "Solo se aceptan archivos PDF" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Extract text per page
  const pageTexts: Array<{ text: string; pageNumber: number }> = [];
  let pageCounter = 0;

  try {
    await pdfParse(buffer, {
      pagerender(pageData: PdfPageData) {
        const pageNumber = ++pageCounter;
        return pageData.getTextContent().then(
          (content: { items: Array<{ str: string }> }) => {
            const text = content.items.map((i) => i.str).join(" ");
            pageTexts.push({ text, pageNumber });
            return text;
          }
        );
      },
    });
  } catch {
    // Fallback: parse without page tracking
    try {
      const data = await pdfParse(buffer);
      pageTexts.push({ text: data.text, pageNumber: 1 });
    } catch {
      return NextResponse.json({ error: "No se pudo leer el PDF" }, { status: 422 });
    }
  }

  if (pageTexts.length === 0) {
    return NextResponse.json({ error: "El PDF no contiene texto extraíble" }, { status: 422 });
  }

  const chunks = chunkText(pageTexts);
  if (chunks.length === 0) {
    return NextResponse.json({ error: "El PDF no tiene contenido suficiente" }, { status: 422 });
  }

  // Generate embeddings
  let embeddings: number[][];
  try {
    embeddings = await Promise.all(chunks.map((c) => getEmbedding(c.content)));
  } catch (err) {
    console.error("Embedding error:", err);
    return NextResponse.json({ error: "Error al generar embeddings" }, { status: 500 });
  }

  // Save document + chunks transactionally
  const doc = await prisma.knowledgeDocument.create({
    data: {
      title,
      fileName: file.name,
      uploadedById: session.userId,
      chunks: {
        create: chunks.map((chunk, i) => ({
          content: chunk.content,
          embedding: embeddings[i],
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
        })),
      },
    },
    select: {
      id: true, title: true, fileName: true, createdAt: true,
      _count: { select: { chunks: true } },
    },
  });

  return NextResponse.json(doc, { status: 201 });
}
