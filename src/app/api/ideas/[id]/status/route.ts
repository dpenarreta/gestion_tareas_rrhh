import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoIdeaToNexoShape, type DjangoIdea } from "@/lib/djangoIdeasAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. La máquina de estados, la notificación al autor y el
// badge "innovador" (asignado al llegar a IMPLEMENTADA, cerrado en la Fase
// 27) ya viven en `apps.ideas.services.change_idea_status` — el `route.ts`
// no repite esa lógica, solo reenvía la acción.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const comment = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;

  const response = await djangoApiFetch(`/ideas/${id}/status/`, {
    method: "PATCH",
    body: JSON.stringify({ action, comment }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos para mover ideas" }, { status: 403 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Acción inválida" }, { status: 400 });
  }

  const idea: DjangoIdea = await response.json();
  return NextResponse.json(mapDjangoIdeaToNexoShape(idea));
}
