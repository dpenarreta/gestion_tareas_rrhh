import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoActivityToNexoShape, type DjangoActivity } from "@/lib/djangoTasksAdapter";

// Fase 3b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// esta ruta pasó de Prisma a Django. Sin `migrateFijaHistoryIfNeeded` (no
// aplica: los Task de Django no tienen historial previo que conciliar).
// La invalidación de caché de Analytics se omite (el motor sigue leyendo
// Postgres, que esta ruta ya no toca).
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

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/tasks/${id}/activities/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  // Igual que el legacy: sin acceso a la tarea, se responde lista vacía en
  // vez de revelar si existe.
  if (!response.ok) {
    return NextResponse.json([], { status: 200 });
  }

  const activities: DjangoActivity[] = await response.json();
  return NextResponse.json(activities.map(mapDjangoActivityToNexoShape));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: taskId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { reason, hours, minutes, description, startTime, endTime } = body;

  if (!reason || hours === undefined || minutes === undefined) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/tasks/${taskId}/activities/`, {
    method: "POST",
    body: JSON.stringify({
      reason,
      hours,
      minutes,
      description: description ?? "",
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
    // Nota: a diferencia del legacy (400 vs 409 según el tipo de error),
    // Django devuelve 400 de forma uniforme para todas las validaciones de
    // ActivityService (motivo inválido, límite Fija, solapamiento) — gap
    // documentado, sin impacto funcional conocido (el frontend solo lee
    // `error` del cuerpo, no distingue por código de estado).
    const message = await extractDjangoErrorMessage(response, "No se pudo registrar la actividad");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const activity = mapDjangoActivityToNexoShape(await response.json());
  return NextResponse.json(activity, { status: 201 });
}
