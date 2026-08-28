import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageKnowledgeBase, canViewKnowledgeBase } from "@/lib/roles";
import { uploadPdfToGithub, processGithubDocument } from "@/lib/githubDocuments";
import {
  createDjangoKnowledgeDocument,
  fetchDjangoKnowledgeDocument,
  fetchDjangoKnowledgeDocuments,
  mapDjangoKnowledgeDocumentToNexoShape,
  updateDjangoKnowledgeDocument,
} from "@/lib/djangoAssistantAdapter";

// Documentos grandes (cientos de páginas → cientos de chunks) pueden tardar
// más que el límite por defecto en generar todos los embeddings, incluso en
// lotes concurrentes — se sube el máximo para no truncar el procesamiento.
export const maxDuration = 300;

// Vercel (plan gratuito) rechaza el request completo por encima de 4.5MB antes
// de que este handler se ejecute, así que validamos con el mismo margen para
// poder devolver un mensaje claro en vez de dejar que la plataforma corte la conexión.
const MAX_SIZE_BYTES = 4.5 * 1024 * 1024;
const MAX_SIZE_MESSAGE = "El archivo supera el límite de 4.5MB. Por favor usa un archivo más pequeño.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 58): esta ruta
// pasó de Prisma a Django (`apps.assistant`). El procesamiento del PDF
// (descarga/extracción/chunking/embeddings) sigue en `githubDocuments.ts`,
// sin cambios de comportamiento — solo la persistencia se movió.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewKnowledgeBase(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const docs = await fetchDjangoKnowledgeDocuments();
  if (!docs) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  return NextResponse.json(docs.map(mapDjangoKnowledgeDocumentToNexoShape));
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

    const doc = await createDjangoKnowledgeDocument(title, file.name);
    if (!doc) {
      return NextResponse.json(
        { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
        { status: 401 }
      );
    }
    const documentId = String(doc.id);

    let githubInfo: { path: string; sha: string };
    try {
      githubInfo = await uploadPdfToGithub(documentId, file.name, buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[POST /api/assistant/documents] documento ${documentId}: subida a GitHub falló:`, err);
      const failed = await updateDjangoKnowledgeDocument(documentId, { status: "ERROR", processingError: message });
      return NextResponse.json(failed ? mapDjangoKnowledgeDocumentToNexoShape(failed) : null, { status: 201 });
    }

    await updateDjangoKnowledgeDocument(documentId, { githubPath: githubInfo.path, githubSha: githubInfo.sha });

    await processGithubDocument(documentId, githubInfo.path, githubInfo.sha);

    const processed = await fetchDjangoKnowledgeDocument(documentId);

    return NextResponse.json(processed ? mapDjangoKnowledgeDocumentToNexoShape(processed) : null, { status: 201 });
  } catch (err) {
    console.error("[POST /api/assistant/documents] error inesperado:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Error al agregar el documento: ${message}` }, { status: 500 });
  }
}
