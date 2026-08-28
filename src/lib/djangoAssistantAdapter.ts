import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Adaptador entre la base de conocimiento del Asistente LLM/RAG de Django
 * (Fase 58 de la migración de stack, ver docs/AUDIT_LOG.md § 2026-08-25) y
 * la forma que ya espera `AssistantModule.tsx` (sin cambios). El cálculo de
 * embeddings sigue en `src/lib/embeddings.ts` (@xenova/transformers, sin
 * cambios) — este adaptador solo persiste/lee lo que Next.js ya calculó.
 */

export type DjangoKnowledgeDocument = {
  id: number;
  title: string;
  file_name: string;
  github_path: string | null;
  github_sha: string | null;
  created_at: string;
  status: "PROCESANDO" | "LISTO" | "ERROR";
  processing_error: string | null;
  uploaded_by_name: string;
  chunk_count: number;
};

export type NexoKnowledgeDocument = {
  id: string;
  title: string;
  fileName: string;
  githubPath: string | null;
  createdAt: string;
  status: "PROCESANDO" | "LISTO" | "ERROR";
  processingError: string | null;
  uploadedBy: { name: string };
  _count: { chunks: number };
};

export function mapDjangoKnowledgeDocumentToNexoShape(doc: DjangoKnowledgeDocument): NexoKnowledgeDocument {
  return {
    id: String(doc.id),
    title: doc.title,
    fileName: doc.file_name,
    githubPath: doc.github_path,
    createdAt: doc.created_at,
    status: doc.status,
    processingError: doc.processing_error,
    uploadedBy: { name: doc.uploaded_by_name },
    _count: { chunks: doc.chunk_count },
  };
}

export async function fetchDjangoKnowledgeDocuments(): Promise<DjangoKnowledgeDocument[] | null> {
  const response = await djangoApiFetch("/assistant/documents/");
  if (!response || !response.ok) return null;
  return response.json();
}

/** Lectura de UN documento — aditiva, sin equivalente en el TS legacy
 * (que nunca tuvo esta ruta como detalle propio). Next.js la necesita
 * para leer el estado final del documento después de que
 * `processGithubDocument` termina de escribirlo en varios pasos. */
export async function fetchDjangoKnowledgeDocument(id: string): Promise<DjangoKnowledgeDocument | null> {
  const response = await djangoApiFetch(`/assistant/documents/${id}/`);
  if (!response || !response.ok) return null;
  return response.json();
}

export async function createDjangoKnowledgeDocument(
  title: string,
  fileName: string,
): Promise<DjangoKnowledgeDocument | null> {
  const response = await djangoApiFetch("/assistant/documents/", {
    method: "POST",
    body: JSON.stringify({ title, file_name: fileName }),
  });
  if (!response || !response.ok) return null;
  return response.json();
}

export type DjangoKnowledgeDocumentPatch = Partial<{
  githubPath: string;
  githubSha: string;
  status: "PROCESANDO" | "LISTO" | "ERROR";
  processingError: string | null;
  content: string | null;
}>;

export async function updateDjangoKnowledgeDocument(
  id: string,
  patch: DjangoKnowledgeDocumentPatch,
): Promise<DjangoKnowledgeDocument | null> {
  const body: Record<string, unknown> = {};
  if (patch.githubPath !== undefined) body.github_path = patch.githubPath;
  if (patch.githubSha !== undefined) body.github_sha = patch.githubSha;
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.processingError !== undefined) body.processing_error = patch.processingError;
  if (patch.content !== undefined) body.content = patch.content;

  const response = await djangoApiFetch(`/assistant/documents/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!response || !response.ok) return null;
  return response.json();
}

export async function deleteDjangoKnowledgeDocument(id: string): Promise<boolean> {
  const response = await djangoApiFetch(`/assistant/documents/${id}/`, { method: "DELETE" });
  return Boolean(response && response.ok);
}

export type DjangoChunkInput = { content: string; embedding: number[]; page_number: number; chunk_index: number };

/** `false` si Django no tiene sesión disponible o la escritura falló — el
 * caller (`processGithubDocument`) ya se degrada con gracia en ese caso
 * (documento queda en el estado que tenía, sin `chunks` indexados).
 * `content` es opcional — el texto completo extraído del PDF, persistido en
 * la MISMA llamada que los chunks (réplica de la transacción atómica que
 * hacía `prisma.knowledgeDocument.update` con `chunks: { create: [...] }`
 * anidado en el `route.ts` original). */
export async function bulkCreateDjangoDocumentChunks(
  id: string,
  chunks: DjangoChunkInput[],
  content?: string,
): Promise<boolean> {
  const response = await djangoApiFetch(`/assistant/documents/${id}/chunks/`, {
    method: "POST",
    body: JSON.stringify(content !== undefined ? { chunks, content } : { chunks }),
  });
  return Boolean(response && response.ok);
}

export type DjangoDocumentChunkRow = {
  content: string;
  embedding: number[];
  page_number: number;
  doc_title: string;
  doc_file_name: string;
};

/** `[]` si Django no tiene sesión disponible — `findRelevantChunks`
 * simplemente no encuentra fragmentos relevantes, mismo comportamiento que
 * el original ante una base de conocimiento vacía. */
export async function fetchDjangoDocumentChunks(): Promise<DjangoDocumentChunkRow[]> {
  const response = await djangoApiFetch("/assistant/chunks/");
  if (!response || !response.ok) return [];
  return response.json();
}
