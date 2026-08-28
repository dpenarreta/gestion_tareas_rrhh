import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectCommentToNexoShape,
  type DjangoProjectComment,
} from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${projectId}/comments/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron obtener los comentarios" }, { status: 400 });
  }

  const comments: DjangoProjectComment[] = await response.json();
  return NextResponse.json(comments.map(mapDjangoProjectCommentToNexoShape));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { text } = body as { text?: string };

  const response = await djangoApiFetch(`/projects/${projectId}/comments/`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Solo los participantes del proyecto pueden comentar" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "El comentario no puede estar vacío");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const comment: DjangoProjectComment = await response.json();
  return NextResponse.json(mapDjangoProjectCommentToNexoShape(comment), { status: 201 });
}
