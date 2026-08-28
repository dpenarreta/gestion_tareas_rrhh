import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoActivityReasons, mapDjangoActivityReasonToNexoShape } from "@/lib/djangoTasksAdapter";

// Fase 3b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// cortado a Django. Lista completa (activos e inactivos) — mismo criterio
// que el legacy: el selector de actividades filtra por rol+activo en el
// cliente, y el histórico necesita resolver labels de motivos ya
// desactivados.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const reasons = await fetchDjangoActivityReasons();
  if (reasons === null) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  return NextResponse.json(reasons.map(mapDjangoActivityReasonToNexoShape));
}
