import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoTaskToNexoShape } from "@/lib/djangoTasksAdapter";

// Sub-fase 3d de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. `IsAdministrador` (`is_superuser`) vive
// 100% del lado Django — esta ruta solo verifica que haya sesión (401).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

async function extractDjangoErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    const nonFieldError = data?.error?.details?.non_field_errors?.[0];
    if (typeof nonFieldError === "string") return nonFieldError;
    const firstFieldError = Object.values(data?.error?.details ?? {})[0];
    if (Array.isArray(firstFieldError) && typeof firstFieldError[0] === "string") return firstFieldError[0];
    if (typeof data?.error?.message === "string") return data.error.message;
  } catch {
    // respuesta sin cuerpo JSON — se usa el mensaje por defecto
  }
  return fallback;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { realHours?: unknown; status?: unknown };

  const response = await djangoApiFetch(`/tasks/${id}/correct/`, {
    method: "PATCH",
    body: JSON.stringify({
      real_hours: body.realHours,
      status: body.status,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json(
      { error: "Solo un Administrador puede corregir tareas archivadas" },
      { status: 403 }
    );
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    const message = await extractDjangoErrorMessage(response, "No se pudo corregir la tarea");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(mapDjangoTaskToNexoShape(await response.json()));
}
