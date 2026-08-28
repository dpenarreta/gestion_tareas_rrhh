import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

// Sub-fase 3c-bulk de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. `CanRegularize` (ADMINISTRADOR/
// JEFE_NACIONAL) vive 100% del lado Django — esta ruta solo verifica que
// haya sesión (401), igual criterio que la validación individual de 3c.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

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

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = (await request.json()) as {
    items?: { taskId?: unknown; newEndDate?: unknown }[];
    observaciones?: unknown;
  };

  const items = Array.isArray(body.items)
    ? body.items.map((item) => ({
        task_id: item.taskId,
        new_end_date: typeof item.newEndDate === "string" && item.newEndDate ? item.newEndDate : null,
      }))
    : [];

  const response = await djangoApiFetch("/tasks/end-date/bulk-approve/", {
    method: "POST",
    body: JSON.stringify({
      items,
      observaciones: typeof body.observaciones === "string" ? body.observaciones.trim() || null : null,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoErrorMessage(response, "Debes seleccionar al menos una tarea");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const data = (await response.json()) as {
    updated_count: number;
    skipped_self_assigned: number[];
    skipped_invalid_date: number[];
  };
  return NextResponse.json({
    updatedCount: data.updated_count,
    skippedSelfAssigned: data.skipped_self_assigned.map(String),
    skippedInvalidDate: data.skipped_invalid_date.map(String),
  });
}
