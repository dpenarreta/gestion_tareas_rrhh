import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoRepositoryTasks, mapDjangoTaskToNexoShape } from "@/lib/djangoTasksAdapter";

// Sub-fase 3d de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. Mismo gap de visibilidad que
// `/api/repository` (ver ese archivo).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ year: string; month: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { year, month } = await ctx.params;
  if (Number.isNaN(parseInt(year, 10)) || Number.isNaN(parseInt(month, 10))) {
    return NextResponse.json({ error: "Año o mes inválido" }, { status: 400 });
  }

  const tasks = await fetchDjangoRepositoryTasks(year, month);
  if (tasks === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (tasks === null) {
    return NextResponse.json({ error: "Este mes no ha sido cerrado" }, { status: 404 });
  }

  return NextResponse.json(tasks.map(mapDjangoTaskToNexoShape));
}
