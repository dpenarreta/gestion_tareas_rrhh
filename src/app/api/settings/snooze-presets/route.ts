import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Presets de posposición de recordatorios (minutos) — alcanzable por
 * CUALQUIER usuario autenticado (Escritorio Digital lo usa cualquier rol no
 * Administrador).
 *
 * Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): el consumidor real
 * (Escritorio Digital / recordatorios) ya vive en Django, de ahí que esta
 * lectura también se corte — antes reflejaba un valor de Postgres que el
 * feature ya cutover jamás consultaba.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/snooze-presets/");
  if (!response || !response.ok) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  const data = (await response.json()) as { minutes: number[] };
  return NextResponse.json({ minutes: data.minutes });
}
