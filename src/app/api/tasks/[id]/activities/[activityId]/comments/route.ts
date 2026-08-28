import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoActivityCommentToNexoShape, type DjangoActivityComment } from "@/lib/djangoTasksAdapter";

// Sub-fase 3f de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. Acceso a la tarea (`CanAccessTask`) vive
// 100% del lado Django — esta ruta solo verifica que haya sesión (401).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string; activityId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId, activityId } = await ctx.params;
  const response = await djangoApiFetch(`/tasks/${taskId}/activities/${activityId}/comments/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  // Igual que el legacy: cualquier error se responde con lista vacía en
  // vez de propagarlo (ver `catch` original que devuelve `[]` con 200).
  if (!response.ok) {
    return NextResponse.json([], { status: 200 });
  }

  const comments: DjangoActivityComment[] = await response.json();
  return NextResponse.json(comments.map(mapDjangoActivityCommentToNexoShape));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId, activityId } = await ctx.params;
  const body = (await request.json()) as { text?: string };
  if (!body.text?.trim()) {
    return NextResponse.json({ error: "El comentario no puede estar vacío" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/tasks/${taskId}/activities/${activityId}/comments/`, {
    method: "POST",
    body: JSON.stringify({ text: body.text.trim() }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const comment = mapDjangoActivityCommentToNexoShape(await response.json());
  return NextResponse.json(comment, { status: 201 });
}
