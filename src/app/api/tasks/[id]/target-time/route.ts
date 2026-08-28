import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchDjangoTargetTimeInfo, mapDjangoTargetTimeInfoToNexoShape } from "@/lib/djangoTasksAdapter";

// Fase 3c de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// cortado a Django. La autorización de validación se simplifica a
// `usuarios.editar` + "no soy el propio responsable" — equivalente al
// legacy en el estado actual del catálogo (ver plan de Fase 3c). Nunca
// toca `real_hours` — igual que el legacy.
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

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const info = await fetchDjangoTargetTimeInfo(id);
  if (info === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!info) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  return NextResponse.json(mapDjangoTargetTimeInfoToNexoShape(info));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json()) as { newValue?: unknown; reason?: unknown; reasonDetail?: unknown };

  const response = await djangoApiFetch(`/tasks/${id}/target-time/`, {
    method: "POST",
    body: JSON.stringify({
      new_value: body.newValue,
      reason: body.reason,
      reason_detail: typeof body.reasonDetail === "string" ? body.reasonDetail.trim() || null : null,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    const message = await extractDjangoErrorMessage(
      response,
      "Sin permisos para validar el Tiempo Objetivo de esta tarea"
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(mapDjangoTargetTimeInfoToNexoShape(await response.json()));
}
