import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  mapDjangoNovedadesError,
  mapDjangoNovedadesPayloadToNexoShape,
  mapNexoNovedadesBodyToDjango,
} from "@/lib/djangoNovedadesAdapter";

type Ctx = { params: Promise<{ path: string[] }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Importar/exportar Excel puede tardar bastante más que el timeout general
// (3 s) de `djangoApiFetch`; el resto de operaciones del módulo, no.
const SLOW_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const SEGMENT_RE = /^[a-z0-9-]+$/;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Proxy del módulo Control Operativo de Novedades hacia Django
 * (`/api/v1/novedades/<path>/`). No decide ninguna autorización: Django
 * revalida permisos efectivos, ámbito de datos y estado del período en cada
 * llamada (`backend/apps/novedades/access.py`). Acá solo se valida la ruta,
 * se adapta el formato (snake↔camel) y se reenvían archivos Excel tal cual.
 */
async function forward(request: NextRequest, ctx: Ctx, method: string) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { path } = await ctx.params;
  if (!path.length || !path.every((segment) => SEGMENT_RE.test(segment))) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 404 });
  }
  const djangoPath = `/novedades/${path.join("/")}/${request.nextUrl.search}`;
  const slow = path.includes("imports") || path.includes("export");

  const init: RequestInit = { method };
  if (method !== "GET") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      init.body = await request.formData();
    } else {
      const body = await request.json().catch(() => ({}));
      init.body = JSON.stringify(mapNexoNovedadesBodyToDjango(body));
    }
  }

  let response: Response | null;
  try {
    response = await djangoApiFetch(djangoPath, init, slow ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  } catch {
    return NextResponse.json(
      { error: "El servidor tardó demasiado en responder. Intente nuevamente." },
      { status: 504 },
    );
  }
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 204) return new NextResponse(null, { status: 204 });

  const responseType = response.headers.get("content-type") ?? "";
  if (response.ok && responseType.includes(XLSX)) {
    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": XLSX,
        "Content-Disposition": response.headers.get("content-disposition") ?? 'attachment; filename="novedades.xlsx"',
      },
    });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 403 ? "Sin permisos para esta acción" : "No se pudo completar la acción";
    return NextResponse.json(mapDjangoNovedadesError(data, fallback), { status: response.status });
  }
  return NextResponse.json(mapDjangoNovedadesPayloadToNexoShape(data), { status: response.status });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "GET");
}

export async function POST(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "POST");
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "PATCH");
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "DELETE");
}
