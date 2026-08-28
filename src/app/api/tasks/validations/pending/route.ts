import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoPendingValidations, mapDjangoPendingValidationsToNexoShape } from "@/lib/djangoTasksAdapter";

// Sub-fase 3c-bulk de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. `CanRegularize` (ADMINISTRADOR/
// JEFE_NACIONAL) vive 100% del lado Django — esta ruta solo verifica que
// haya sesión (401), igual criterio que la validación individual de 3c.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const result = await fetchDjangoPendingValidations({
    userId: searchParams.get("userId") ?? undefined,
    role: searchParams.get("role") ?? undefined,
    type: searchParams.get("type") ?? undefined,
  });

  if (result === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  // Este GET no tiene cuerpo que pueda fallar validación — la única forma
  // real de que Django responda !ok es `CanRegularize` (403).
  if (result === null) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json(mapDjangoPendingValidationsToNexoShape(result));
}
