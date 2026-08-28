import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django — descarga bajo demanda, réplica
// exacta del orden de validación de Django (404 antes que 403, ver
// `DeskNoteViewSet.attachment`, Fase 7d).
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/desk-notes/${id}/attachment/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const buffer = await response.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? 'attachment; filename="adjunto"',
    },
  });
}
