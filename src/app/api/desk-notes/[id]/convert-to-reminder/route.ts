import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { extractDjangoDeskErrorMessage } from "@/lib/djangoDeskAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django (`DeskNoteViewSet.convert_to_reminder`,
// Fase 7e).
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown; dueAt?: unknown; priority?: unknown };

  const response = await djangoApiFetch(`/desk-notes/${id}/convert-to-reminder/`, {
    method: "POST",
    body: JSON.stringify({
      title: typeof body.title === "string" ? body.title : undefined,
      due_at: body.dueAt,
      priority: typeof body.priority === "string" ? body.priority : undefined,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (response.status === 409) {
    return NextResponse.json({ error: "Esta nota ya fue convertida en recordatorio" }, { status: 409 });
  }
  if (!response.ok) {
    const message = await extractDjangoDeskErrorMessage(response, "Falta la fecha/hora del recordatorio");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const data = (await response.json()) as { reminder_id: number; reminder_title: string };
  return NextResponse.json({ reminderId: String(data.reminder_id), reminderTitle: data.reminder_title }, { status: 201 });
}
