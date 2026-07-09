import "server-only";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/embeddings";

const FETCH_TIMEOUT_MS = 45_000;
const FRIENDLY_PENDING_MESSAGE = "Documento agregado. El texto se procesará cuando esté disponible.";

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

function driveDocsExportUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${fileId}/export?format=txt`;
}

async function fetchWithTimeout(url: string, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    console.error(`[driveDocuments] fetching ${label}: ${url}`);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    console.error(`[driveDocuments] ${label} -> HTTP ${res.status}, content-type=${res.headers.get("content-type")}`);
    return res;
  } catch (err) {
    console.error(`[driveDocuments] ${label} fetch threw:`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Descarga el archivo probando, en orden: el link directo de descarga, el
 * mismo link forzando el bypass de la pantalla de confirmación de Drive
 * (&confirm=t, para archivos grandes o sin escaneo de virus), y como último
 * recurso la exportación de Google Docs a texto plano (solo funciona si el
 * documento es un Google Doc nativo, no un PDF subido — se intenta igual
 * porque es gratis intentarlo y a veces es el único que responde).
 */
async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const attempts: Array<{ label: string; url: string }> = [
    { label: "descarga directa", url: driveDownloadUrl(fileId, false) },
    { label: "descarga con confirm=t", url: driveDownloadUrl(fileId, true) },
    { label: "exportación de Google Docs a texto", url: driveDocsExportUrl(fileId) },
  ];

  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, attempt.label);
      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} en ${attempt.label}`);
        continue;
      }
      if (contentType.includes("text/html")) {
        // Página de confirmación/consentimiento de Drive — probar el siguiente método.
        lastError = new Error(`${attempt.label} devolvió una página HTML en vez del archivo`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) {
        lastError = new Error(`${attempt.label} devolvió un archivo vacío`);
        continue;
      }
      return { buffer, contentType };
    } catch (err) {
      lastError = err;
      console.error(`[driveDocuments] intento "${attempt.label}" falló:`, err);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `No se pudo descargar el archivo de Drive tras varios intentos (${message}). Verifica que el acceso sea "Cualquiera con el link puede ver".`
  );
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
      await parser.destroy().catch((err) => {
        console.error("[driveDocuments] error liberando el parser de PDF:", err);
      });
    }
  }
  return [{ text: buffer.toString("utf-8"), pageNumber: 1 }];
}

/**
 * Genera el embedding de cada chunk. Un fallo puntual (p. ej. el modelo no
 * pudo descargarse a tiempo) no debe tirar todo el documento — ese chunk
 * queda con embedding vacío (no participa en la búsqueda semántica, pero el
 * resto del documento sí queda indexado).
 */
async function embedChunks(
  chunkInputs: Array<{ content: string; pageNumber: number; chunkIndex: number }>
): Promise<Array<{ content: string; pageNumber: number; chunkIndex: number; embedding: number[] }>> {
  const results: Array<{ content: string; pageNumber: number; chunkIndex: number; embedding: number[] }> = [];
  for (const c of chunkInputs) {
    try {
      const embedding = await getEmbedding(c.content);
      results.push({ ...c, embedding });
    } catch (err) {
      console.error(`[driveDocuments] fallo generando embedding del chunk ${c.chunkIndex}:`, err);
      results.push({ ...c, embedding: [] });
    }
  }
  return results;
}

export async function processDriveDocument(documentId: string, driveFileId: string): Promise<void> {
  let buffer: Buffer;
  let contentType: string;
  try {
    ({ buffer, contentType } = await downloadDriveFile(driveFileId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[driveDocuments] documento ${documentId}: descarga falló:`, err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "ERROR", processingError: message } })
      .catch((updateErr) => console.error(`[driveDocuments] documento ${documentId}: no se pudo guardar el error:`, updateErr));
    return;
  }

  // A partir de aquí el archivo SÍ se descargó — cualquier fallo posterior
  // (extracción de texto, chunking, embeddings) se degrada con gracia: el
  // documento queda guardado y disponible, solo sin indexar para búsqueda.
  let pages: Array<{ text: string; pageNumber: number }> = [];
  try {
    pages = await extractPages(buffer, contentType);
  } catch (err) {
    console.error(`[driveDocuments] documento ${documentId}: extracción de texto falló:`, err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "LISTO", content: null, processingError: FRIENDLY_PENDING_MESSAGE } })
      .catch((updateErr) => console.error(`[driveDocuments] documento ${documentId}: no se pudo guardar el estado pendiente:`, updateErr));
    return;
  }

  const fullText = pages.map((p) => p.text).join("\n\n").trim();
  const chunkInputs: Array<{ content: string; pageNumber: number; chunkIndex: number }> = [];
  let chunkIndex = 0;
  for (const page of pages) {
    for (const c of chunkPlainText(page.text)) {
      chunkInputs.push({ content: c.content, pageNumber: page.pageNumber, chunkIndex: chunkIndex++ });
    }
  }

  if (fullText.length < 80 || chunkInputs.length === 0) {
    console.error(`[driveDocuments] documento ${documentId}: sin contenido de texto suficiente para indexar`);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "LISTO", content: fullText || null, processingError: FRIENDLY_PENDING_MESSAGE } })
      .catch((updateErr) => console.error(`[driveDocuments] documento ${documentId}: no se pudo guardar el estado pendiente:`, updateErr));
    return;
  }

  const chunksWithEmbeddings = await embedChunks(chunkInputs);

  try {
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
    console.error(`[driveDocuments] documento ${documentId}: procesado OK, ${chunksWithEmbeddings.length} chunks`);
  } catch (err) {
    console.error(`[driveDocuments] documento ${documentId}: fallo guardando chunks:`, err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "LISTO", content: fullText, processingError: FRIENDLY_PENDING_MESSAGE } })
      .catch((updateErr) => console.error(`[driveDocuments] documento ${documentId}: no se pudo guardar el estado pendiente:`, updateErr));
  }
}
