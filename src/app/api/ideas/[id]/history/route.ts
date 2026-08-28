import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoIdeaHistoryToNexoShape, type DjangoIdeaHistoryEntry } from "@/lib/djangoIdeasAdapter";

type Ctx = { params: Promise<{ id: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/ideas/${id}/history/`);
  if (!response) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener el historial" }, { status: 400 });
  }

  const history: DjangoIdeaHistoryEntry[] = await response.json();
  return NextResponse.json(mapDjangoIdeaHistoryToNexoShape(history));
}
