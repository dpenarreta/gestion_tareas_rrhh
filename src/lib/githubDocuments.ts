import "server-only";
import "@/lib/pdfPolyfill";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/embeddings";

const FETCH_TIMEOUT_MS = 45_000;
const FRIENDLY_PENDING_MESSAGE = "Documento agregado. El texto se procesará cuando esté disponible.";
const GITHUB_API_VERSION = "2022-11-28";

function githubConfig(): { token: string; repo: string } {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_DOCS_REPO;
  console.error(
    `[githubDocuments] GITHUB_TOKEN presente: ${!!token} (prefijo: ${token ? token.slice(0, 10) : "n/a"}), GITHUB_DOCS_REPO: ${repo ?? "n/a"}`
  );
  if (!token || !repo) {
    throw new Error("GITHUB_TOKEN o GITHUB_DOCS_REPO no están configurados en las variables de entorno.");
  }
  return { token, repo };
}

/** Crea el repositorio configurado si todavía no existe (privado, bajo la cuenta del token). */
async function ensureRepoExists(token: string, repo: string): Promise<void> {
  const checkRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}`,
    { headers: githubHeaders(token) },
    "verificar repo"
  );
  if (checkRes.ok) return;
  if (checkRes.status !== 404) {
    const body = await checkRes.text().catch(() => "");
    console.error(`[githubDocuments] verificación de repo devolvió HTTP ${checkRes.status}:`, body);
    return;
  }

  const name = repo.includes("/") ? repo.split("/")[1] : repo;
  console.error(`[githubDocuments] el repo "${repo}" no existe, creando "${name}"...`);
  const createRes = await fetchWithTimeout(
    "https://api.github.com/user/repos",
    {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name, private: true }),
    },
    "crear repo"
  );
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    console.error(`[githubDocuments] fallo creando el repo "${name}":`, createRes.status, body);
    throw new Error(`No se pudo crear el repositorio "${name}" en GitHub (HTTP ${createRes.status}).`);
  }
  console.error(`[githubDocuments] repo "${name}" creado correctamente`);
}

function githubHeaders(token: string, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "nexo-app",
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    console.error(`[githubDocuments] ${label}: ${init.method ?? "GET"} ${url}`);
    const res = await fetch(url, { ...init, signal: controller.signal });
    console.error(`[githubDocuments] ${label} -> HTTP ${res.status}`);
    return res;
  } catch (err) {
    console.error(`[githubDocuments] ${label} fetch threw:`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

/** Sube el PDF al repo de GitHub configurado (contenido en base64, vía Contents API). */
export async function uploadPdfToGithub(
  documentId: string,
  originalFilename: string,
  buffer: Buffer
): Promise<{ path: string; sha: string }> {
  const { token, repo } = githubConfig();
  await ensureRepoExists(token, repo);

  const path = `docs/${documentId}-${sanitizeFilename(originalFilename)}`;
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "PUT",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Agregar documento: ${originalFilename}`,
        content: buffer.toString("base64"),
      }),
    },
    "subir a GitHub"
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[githubDocuments] fallo al subir "${originalFilename}":`, res.status, errBody);
    throw new Error(`No se pudo subir el archivo a GitHub (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { content?: { path?: string; sha?: string } };
  if (!data.content?.path || !data.content?.sha) {
    throw new Error("GitHub no devolvió la ruta/sha del archivo subido.");
  }
  return { path: data.content.path, sha: data.content.sha };
}

/** Descarga el archivo vía la API de Git Blobs (soporta hasta 100MB, sin el límite de 1MB de la Contents API). */
async function downloadFromGithub(path: string, sha: string): Promise<Buffer> {
  const { token, repo } = githubConfig();
  const url = `https://api.github.com/repos/${repo}/git/blobs/${sha}`;

  const res = await fetchWithTimeout(url, { headers: githubHeaders(token) }, "descargar de GitHub");
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[githubDocuments] fallo al descargar "${path}" (sha ${sha}):`, res.status, errBody);
    throw new Error(`No se pudo descargar el archivo desde GitHub (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") {
    throw new Error("GitHub devolvió el archivo en un formato inesperado.");
  }
  // El content en base64 que devuelve la API de blobs viene con saltos de línea cada 60 chars.
  return Buffer.from(data.content.replace(/\n/g, ""), "base64");
}

export async function deleteFromGithub(path: string, sha: string): Promise<void> {
  const { token, repo } = githubConfig();
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "DELETE",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Eliminar documento: ${path}`, sha }),
    },
    "eliminar de GitHub"
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[githubDocuments] fallo al eliminar "${path}" de GitHub:`, res.status, errBody);
    // No relanzamos: si el archivo ya no existe en GitHub (404) o el repo cambió,
    // igual queremos que el documento se borre de la base de datos.
  }
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

async function extractPages(buffer: Buffer): Promise<Array<{ text: string; pageNumber: number }>> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ text: p.text, pageNumber: p.num }));
  } finally {
    await parser.destroy().catch((err) => {
      console.error("[githubDocuments] error liberando el parser de PDF:", err);
    });
  }
}

/**
 * Genera el embedding de cada chunk. Un fallo puntual no debe tirar todo el
 * documento — ese chunk queda con embedding vacío (no participa en la
 * búsqueda semántica, pero el resto del documento sí queda indexado).
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
      console.error(`[githubDocuments] fallo generando embedding del chunk ${c.chunkIndex}:`, err);
      results.push({ ...c, embedding: [] });
    }
  }
  return results;
}

/**
 * Descarga el PDF ya subido a GitHub, extrae texto, trocea y genera
 * embeddings. Se degrada con gracia en cada etapa: un fallo de descarga deja
 * el documento en ERROR (nada que mostrar); un fallo posterior (extracción de
 * texto o embeddings) deja el documento LISTO igual, con un aviso informativo
 * en vez de un error duro — el archivo ya está a salvo en GitHub.
 */
export async function processGithubDocument(documentId: string, path: string, sha: string): Promise<void> {
  let buffer: Buffer;
  try {
    buffer = await downloadFromGithub(path, sha);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[githubDocuments] documento ${documentId}: descarga falló:`, err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "ERROR", processingError: message } })
      .catch((updateErr) => console.error(`[githubDocuments] documento ${documentId}: no se pudo guardar el error:`, updateErr));
    return;
  }

  let pages: Array<{ text: string; pageNumber: number }> = [];
  try {
    pages = await extractPages(buffer);
  } catch (err) {
    console.error(`[githubDocuments] documento ${documentId}: extracción de texto falló:`, err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "LISTO", content: null, processingError: FRIENDLY_PENDING_MESSAGE } })
      .catch((updateErr) => console.error(`[githubDocuments] documento ${documentId}: no se pudo guardar el estado pendiente:`, updateErr));
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
    console.error(`[githubDocuments] documento ${documentId}: sin contenido de texto suficiente para indexar`);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "LISTO", content: fullText || null, processingError: FRIENDLY_PENDING_MESSAGE } })
      .catch((updateErr) => console.error(`[githubDocuments] documento ${documentId}: no se pudo guardar el estado pendiente:`, updateErr));
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
    console.error(`[githubDocuments] documento ${documentId}: procesado OK, ${chunksWithEmbeddings.length} chunks`);
  } catch (err) {
    console.error(`[githubDocuments] documento ${documentId}: fallo guardando chunks:`, err);
    await prisma.knowledgeDocument
      .update({ where: { id: documentId }, data: { status: "LISTO", content: fullText, processingError: FRIENDLY_PENDING_MESSAGE } })
      .catch((updateErr) => console.error(`[githubDocuments] documento ${documentId}: no se pudo guardar el estado pendiente:`, updateErr));
  }
}
