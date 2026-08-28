import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoIdeaDetailToNexoShape, type DjangoIdeaDetail } from "@/lib/djangoIdeasAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. `IdeaDetailView` (backend) ya enmascara el adjunto
// (`attachment_name`/`mime`/`data` en `null`) cuando la idea no está en
// PROPUESTA — mismo comportamiento del TS, replicado del lado Django.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/ideas/${id}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener la idea" }, { status: 400 });
  }

  const idea: DjangoIdeaDetail = await response.json();
  return NextResponse.json(mapDjangoIdeaDetailToNexoShape(idea));
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const progress = body?.progress;

  const response = await djangoApiFetch(`/ideas/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ progress }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos para actualizar el progreso" }, { status: 403 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Progreso inválido (debe ser un entero entre 0 y 100)" }, { status: 400 });
  }

  const idea: DjangoIdeaDetail = await response.json();
  return NextResponse.json(mapDjangoIdeaDetailToNexoShape(idea));
}
