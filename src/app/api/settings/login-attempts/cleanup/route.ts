import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): el login real pasó a
// Django desde la Fase 6a — el `LoginAttempt` de Postgres que este endpoint
// purgaba ya no recibe escrituras desde entonces, así que la versión anterior
// operaba sobre datos congelados. `LoginAttemptsCleanupView` (Fase 33) es la
// réplica adaptada (log por evento, no contador agregado por IP).

/** Vista previa: cuenta los registros de LoginAttempt expirados, sin borrar nada. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const response = await djangoApiFetch("/settings/login-attempts/cleanup/");
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const data = (await response.json()) as { expired_count: number };
  return NextResponse.json({ expiredCount: data.expired_count });
}

/** Elimina los registros de LoginAttempt ya no bloqueantes con más de N días de antigüedad. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const response = await djangoApiFetch("/settings/login-attempts/cleanup/", { method: "POST" });
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const data = (await response.json()) as { deleted: number };
  return NextResponse.json({ deleted: data.deleted });
}
