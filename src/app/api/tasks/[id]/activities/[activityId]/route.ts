import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoActivityToNexoShape } from "@/lib/djangoTasksAdapter";

// Sub-fase 3f de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. `IsAdministrador` (PATCH) / autor-only
// (DELETE) viven 100% del lado Django — esta ruta solo verifica que haya
// sesión (401).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string; activityId: string }> };

async function extractDjangoErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    const nonFieldError = data?.error?.details?.non_field_errors?.[0];
    if (typeof nonFieldError === "string") return nonFieldError;
    if (typeof data?.error?.message === "string") return data.error.message;
  } catch {
    // respuesta sin cuerpo JSON — se usa el mensaje por defecto
  }
  return fallback;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId, activityId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { hours, minutes, comment } = body;

  if (hours === undefined || minutes === undefined) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/tasks/${taskId}/activities/${activityId}/`, {
    method: "PATCH",
    body: JSON.stringify({ hours, minutes, comment }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    const message = await extractDjangoErrorMessage(response, "Error interno al modificar la actividad");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(mapDjangoActivityToNexoShape(await response.json()));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId, activityId } = await ctx.params;
  const response = await djangoApiFetch(`/tasks/${taskId}/activities/${activityId}/`, { method: "DELETE" });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permiso para eliminar" }, { status: 403 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error interno al eliminar actividad" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
