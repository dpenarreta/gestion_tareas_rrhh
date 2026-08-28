import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoRepositoryMonths, mapDjangoRepositoryMonthsToNexoShape } from "@/lib/djangoTasksAdapter";

// Sub-fase 3d de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. Gap de visibilidad documentado en
// `MonthClosureService.list_repository_months` — sin `apps.hierarchy`
// conectado a las vistas, cada usuario ve solo SUS propias tareas
// archivadas (nunca de más respecto al legacy, que usaba `getVisibleRoles`).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const months = await fetchDjangoRepositoryMonths();
  if (months === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (months === null) {
    return NextResponse.json({ error: "No se pudo cargar el repositorio" }, { status: 400 });
  }

  return NextResponse.json(mapDjangoRepositoryMonthsToNexoShape(months));
}
