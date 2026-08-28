import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  fetchDjangoCloseMonthPreview,
  mapDjangoMonthClosurePreviewToNexoShape,
  mapDjangoMonthClosureResultToNexoShape,
} from "@/lib/djangoTasksAdapter";

// Sub-fase 3d de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. `CanCloseMonth` (`usuarios.editar`) vive
// 100% del lado Django — esta ruta solo verifica que haya sesión (401),
// igual criterio que el resto de las rutas de Tareas ya cortadas.
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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const result = await fetchDjangoCloseMonthPreview({
    year: searchParams.get("year") ?? undefined,
    month: searchParams.get("month") ?? undefined,
    cutoffDate: searchParams.get("cutoffDate") ?? undefined,
  });

  if (result === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (result.status === 403) {
    return NextResponse.json({ error: "Sin permisos para cerrar el mes" }, { status: 403 });
  }
  if (result.data === null) {
    return NextResponse.json({ error: "Año o mes inválido" }, { status: 400 });
  }

  return NextResponse.json(mapDjangoMonthClosurePreviewToNexoShape(result.data));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    year?: unknown;
    month?: unknown;
    cutoffDate?: unknown;
  };

  const response = await djangoApiFetch("/tasks/close-month/", {
    method: "POST",
    body: JSON.stringify({
      year: body.year,
      month: body.month,
      cutoffDate: typeof body.cutoffDate === "string" ? body.cutoffDate : undefined,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos para cerrar el mes" }, { status: 403 });
  }
  if (response.status === 409) {
    return NextResponse.json({ error: "Este mes ya fue cerrado" }, { status: 409 });
  }
  if (!response.ok) {
    const message = await extractDjangoErrorMessage(response, "Año o mes inválido");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(mapDjangoMonthClosureResultToNexoShape(await response.json()));
}
