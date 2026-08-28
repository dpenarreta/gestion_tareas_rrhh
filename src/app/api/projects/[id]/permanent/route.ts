import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

/**
 * Elimina definitivamente un proyecto que ya está en la papelera. A
 * diferencia de DELETE /api/projects/[id] (mover a la papelera), esta acción
 * es irreversible.
 *
 * Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): cierra el gap
 * explícito de la Fase 5f, mismo motivo que `projects/trash/route.ts`.
 * `ProjectViewSet.permanent` (Fase 14 del backend) ya replica el mismo
 * orden de chequeos (404 -> 409 -> 403) que este `route.ts` tenía
 * manualmente.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${id}/permanent/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    const status = [403, 404, 409].includes(response.status) ? response.status : 400;
    return NextResponse.json({ error: message ?? "Error al eliminar definitivamente" }, { status });
  }

  return NextResponse.json({ success: true });
}
