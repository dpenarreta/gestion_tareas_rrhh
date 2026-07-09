import "server-only";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/embeddings";

export function extractDriveFileId(url: string): string | null {
  const patterns = [/\/d\/([a-zA-Z0-9_-]{10,})/, /[?&]id=([a-zA-Z0-9_-]{10,})/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function driveDownloadUrl(fileId: string, confirm: boolean): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}${confirm ? "&confirm=t" : ""}`;
}

async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
  let res = await fetch(driveDownloadUrl(fileId, false));
  let contentType = res.headers.get("content-type") ?? "";

  // Drive interpone una página de confirmación HTML para archivos grandes o
  // sin escaneo de virus (no hay forma de distinguirlo de antemano sin la API).
  if (res.ok && contentType.includes("text/html")) {
    res = await fetch(driveDownloadUrl(fileId, true));
    contentType = res.headers.get("content-type") ?? "";
  }

  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo de Drive (HTTP ${res.status})`);
  }
  if (contentType.includes("text/html")) {
    throw new Error(
      "El link no apunta a un archivo público descargable. Verifica que el acceso sea 'Cualquiera con el link puede ver'."
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

function chunkPlainText(
  text: string,
  chunkSize = 1800,
  overlap = 200
): Array<{ content: string; chunkIndex: number }> {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks: Array<{ content: string; chunkIndex: number }> = [];
  let start = 0;
  let chunkIndex = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    const content = clean.slice(start, end).trim();
    if (content.length > 80) chunks.push({ content, chunkIndex: chunkIndex++ });
    if (end === clean.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

async function extractPages(buffer: Buffer, contentType: string): Promise<Array<{ text: string; pageNumber: number }>> {
  const looksLikePdf = contentType.includes("pdf") || buffer.subarray(0, 4).toString("latin1") === "%PDF";
  if (looksLikePdf) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.pages.map((p) => ({ text: p.text, pageNumber: p.num }));
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  return [{ text: buffer.toString("utf-8"), pageNumber: 1 }];
}

/**
 * Descarga, extrae y trocea el documento de Drive, generando embeddings por
 * chunk. Se ejecuta sincrónicamente dentro del POST (Vercel no garantiza
 * trabajo tras responder), así el estado "Procesando..." es lo que ve el
 * cliente mientras la request está en curso.
 */
export async function processDriveDocument(documentId: string, driveFileId: string): Promise<void> {
  try {
    const { buffer, contentType } = await downloadDriveFile(driveFileId);
    const pages = await extractPages(buffer, contentType);
    const fullText = pages.map((p) => p.text).join("\n\n").trim();

    const chunkInputs: Array<{ content: string; pageNumber: number; chunkIndex: number }> = [];
    let chunkIndex = 0;
    for (const page of pages) {
      for (const c of chunkPlainText(page.text)) {
        chunkInputs.push({ content: c.content, pageNumber: page.pageNumber, chunkIndex: chunkIndex++ });
      }
    }

    if (fullText.length < 80 || chunkInputs.length === 0) {
      throw new Error("El documento no tiene contenido de texto suficiente para indexar.");
    }

    const chunksWithEmbeddings: Array<{ content: string; pageNumber: number; chunkIndex: number; embedding: number[] }> = [];
    for (const c of chunkInputs) {
      const embedding = await getEmbedding(c.content);
      chunksWithEmbeddings.push({ ...c, embedding });
    }

    await prisma.documentChunk.deleteMany({ where: { documentId } });
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        content: fullText,
        status: "LISTO",
        processingError: null,
        chunks: {
          create: chunksWithEmbeddings.map((c) => ({
            content: c.content,
            pageNumber: c.pageNumber,
            chunkIndex: c.chunkIndex,
            embedding: c.embedding,
          })),
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "ERROR", processingError: message } })
      .catch(() => {});
  }
}
