import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoIdeaListItemToNexoShape, mapDjangoIdeaToNexoShape, type DjangoIdeaListItem, type DjangoIdea } from "@/lib/djangoIdeasAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. La visibilidad ("qué ideas ve cada rol") y la
// notificación a revisores ya viven en `apps.ideas.services`
// (`get_visible_idea_author_ids`/`create_idea`) — el `route.ts` no repite
// esa lógica. El adjunto sigue codificándose acá como data: URL, mismo
// contrato ya usado por `desk-notes/route.ts` (Fase 7d) — Django valida
// extensión/tamaño server-side (`IdeaCreateSerializer`).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/ideas/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const ideas: DjangoIdeaListItem[] = await response.json();
  return NextResponse.json(ideas.map(mapDjangoIdeaListItemToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const formData = await request.formData();
  const title = String(formData.get("title") ?? "");
  const description = String(formData.get("description") ?? "");
  const impact = String(formData.get("impact") ?? "");
  const file = formData.get("file");

  let attachmentName: string | null = null;
  let attachmentMime: string | null = null;
  let attachmentData: string | null = null;
  if (file instanceof File && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    attachmentName = file.name;
    attachmentMime = mimeType;
    attachmentData = `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  const response = await djangoApiFetch("/ideas/", {
    method: "POST",
    body: JSON.stringify({
      title,
      description,
      impact,
      attachment_name: attachmentName,
      attachment_mime: attachmentMime,
      attachment_data: attachmentData,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Faltan campos requeridos o son inválidos" }, { status: 400 });
  }

  const created: DjangoIdea = await response.json();
  return NextResponse.json(mapDjangoIdeaToNexoShape(created), { status: 201 });
}
