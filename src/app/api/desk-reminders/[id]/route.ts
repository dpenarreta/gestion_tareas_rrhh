import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { extractDjangoDeskErrorMessage, mapDjangoReminderToNexoShape, type DjangoPersonalReminder } from "@/lib/djangoDeskAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// PATCH/DELETE pasaron a Django (`DeskReminderViewSet.partial_update`/
// `destroy`) — réplica exacta de la cascada de `if` original, resuelta
// del lado Django (Fase 7b): una sola acción `PATCH` cubre `complete`/
// `postpone`/`reopen`/`archive`/`unarchive` o edición directa de campos.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const djangoBody: Record<string, unknown> = { ...body };
  if ("dueAt" in djangoBody) {
    djangoBody.due_at = djangoBody.dueAt;
    delete djangoBody.dueAt;
  }

  const response = await djangoApiFetch(`/desk-reminders/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(djangoBody),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }
  if (response.status === 409) {
    const errorMessage = await extractDjangoDeskErrorMessage(response, "Solo se puede reabrir un recordatorio completado");
    return NextResponse.json({ error: errorMessage }, { status: 409 });
  }
  if (!response.ok) {
    const errorMessage = await extractDjangoDeskErrorMessage(response, "No se pudo actualizar el recordatorio");
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const reminder: DjangoPersonalReminder = await response.json();
  return NextResponse.json(mapDjangoReminderToNexoShape(reminder));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/desk-reminders/${id}/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo eliminar el recordatorio" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
