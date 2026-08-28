import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchDjangoEndDateInfo, mapDjangoEndDateInfoToNexoShape } from "@/lib/djangoTasksAdapter";

// Fase 3c de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// cortado a Django, mismo esqueleto que target-time/route.ts. Gap
// documentado: la notificación al colaborador cuando la Fecha Fin es
// MODIFICADA/RECHAZADA no se replica todavía (Notification no existe en
// Django en esta sub-fase).
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
  const info = await fetchDjangoEndDateInfo(id);
  if (info === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!info) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

  return NextResponse.json(mapDjangoEndDateInfoToNexoShape(info));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json()) as { action?: unknown; newEndDate?: unknown; observaciones?: unknown };

  const response = await djangoApiFetch(`/tasks/${id}/end-date/`, {
    method: "POST",
    body: JSON.stringify({
      action: body.action,
      new_end_date: body.newEndDate ?? null,
      observaciones: typeof body.observaciones === "string" ? body.observaciones.trim() || null : null,
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
      "Sin permisos para validar la Fecha Fin de esta tarea"
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(mapDjangoEndDateInfoToNexoShape(await response.json()));
}
