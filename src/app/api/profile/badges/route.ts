import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): Tareas/Comentarios/
// Actividades (los 3 insumos de este cálculo) ya se escriben exclusivamente
// en Django desde su propio cutover — la versión anterior de este endpoint
// calculaba insignias sobre datos de Postgres cada vez más desactualizados.
// `compute_and_persist_badges` (Fase 27) es réplica exacta, ya en camelCase
// (`badges`/`stats.totalCompleted`/`totalComments`/`currentStreak`/
// `earnedCount`) — no requiere ningún mapeo de campos.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/profile/badges/");
  if (!response || !response.ok) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  return NextResponse.json(await response.json());
}
