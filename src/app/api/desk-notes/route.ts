import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { extractDjangoDeskErrorMessage, mapDjangoDeskNoteToNexoShape, type DjangoDeskNote } from "@/lib/djangoDeskAdapter";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django. Gap explícito y documentado: la
// purga automática de notas archivadas hace 15+ días (`purgeExpiredArchivedNotes`,
// Centro de Recuperación) no se replica todavía — pieza transversal,
// deliberadamente pospuesta (ver docs/ROADMAP.md punto 13).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");
  const limit = searchParams.get("limit");
  const query = new URLSearchParams();
  if (view) query.set("view", view);
  if (limit) query.set("limit", limit);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await djangoApiFetch(`/desk-notes/${suffix}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: response.status });
  }

  const notes: DjangoDeskNote[] = await response.json();
  return NextResponse.json(notes.map(mapDjangoDeskNoteToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const formData = await request.formData();
  const recipientId = String(formData.get("recipientId") ?? "");
  const message = String(formData.get("message") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const color = String(formData.get("color") ?? "");
  const file = formData.get("file");

  if (!recipientId || !message) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  // Django recibe el adjunto como data URL en JSON (ver
  // `ConvertReminderToTaskSerializer`/`DeskNoteCreateSerializer`, Fase 7d)
  // — el `File` de `FormData` se codifica acá, server-side, en vez de en
  // el cliente, para no tocar el formulario existente (mismo criterio que
  // `saveAttachment` legacy, redirigido a Django en vez de a la fila local).
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

  const response = await djangoApiFetch("/desk-notes/", {
    method: "POST",
    body: JSON.stringify({
      recipient: Number(recipientId),
      message,
      priority: priority || undefined,
      color: color || undefined,
      attachment_name: attachmentName,
      attachment_mime: attachmentMime,
      attachment_data: attachmentData,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const errorMessage = await extractDjangoDeskErrorMessage(response, "No se pudo crear la nota");
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const note: DjangoDeskNote = await response.json();
  return NextResponse.json(mapDjangoDeskNoteToNexoShape(note), { status: 201 });
}
