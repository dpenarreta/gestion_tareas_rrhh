import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string; participantId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, participantId } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${projectId}/participants/${participantId}/`, { method: "DELETE" });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para quitar participantes" }, { status: 403 });
  }
  if (response.status === 409) {
    return NextResponse.json(
      { error: "No puedes quitar al responsable principal — cambia el responsable primero" },
      { status: 409 }
    );
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo quitar al participante" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
