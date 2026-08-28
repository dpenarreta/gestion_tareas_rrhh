import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoActivityToNexoShape } from "@/lib/djangoTasksAdapter";

// Sub-fase 3f de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. Sin gate de rol propio — la
// autorización real (`CanAccessTask`) vive en Django.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

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

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { reason, hours, minutes, description, activityDate, startTime, endTime } = body;

  if (!reason || hours === undefined || minutes === undefined || !activityDate) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/tasks/${taskId}/activities/retroactive/`, {
    method: "POST",
    body: JSON.stringify({
      reason,
      hours,
      minutes,
      description: description ?? "",
      activity_date: activityDate,
      start_time: startTime ?? null,
      end_time: endTime ?? null,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    // Nota: a diferencia del legacy (409 para solapamiento), Django
    // devuelve 400 de forma uniforme — mismo gap ya aceptado en 3b para
    // el registro normal de horas.
    const message = await extractDjangoErrorMessage(response, "Error interno al registrar la actividad retroactiva");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const activity = mapDjangoActivityToNexoShape(await response.json());
  return NextResponse.json(activity, { status: 201 });
}
