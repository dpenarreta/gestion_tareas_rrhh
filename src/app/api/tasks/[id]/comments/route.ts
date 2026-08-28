import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoCommentToNexoShape, type DjangoComment } from "@/lib/djangoTasksAdapter";

// Fase 3a de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// gap explícito y documentado — la notificación "hacia arriba" al comentar
// (`getNotificationRules`) todavía no se replica (el modelo Notification
// no existe en Django en esta sub-fase).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/tasks/${id}/comments/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const comments: DjangoComment[] = await response.json();
  return NextResponse.json(comments.map(mapDjangoCommentToNexoShape));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId } = await ctx.params;
  const { text } = await request.json();

  if (!text?.trim()) {
    return NextResponse.json({ error: "El comentario no puede estar vacío" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/tasks/${taskId}/comments/`, {
    method: "POST",
    body: JSON.stringify({ text: text.trim() }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const comment = mapDjangoCommentToNexoShape(await response.json());
  return NextResponse.json(comment, { status: 201 });
}
