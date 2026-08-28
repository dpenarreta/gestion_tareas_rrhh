import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

type Ctx = { params: Promise<{ id: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. `IdeaVoteView`/`toggle_vote` (backend) es réplica exacta
// del toggle simple.
export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/ideas/${id}/vote/`, { method: "POST" });
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
    return NextResponse.json({ error: "No se pudo registrar el voto" }, { status: 400 });
  }

  const data: { vote_count: number; voted_by_me: boolean } = await response.json();
  return NextResponse.json({ voteCount: data.vote_count, votedByMe: data.voted_by_me });
}
