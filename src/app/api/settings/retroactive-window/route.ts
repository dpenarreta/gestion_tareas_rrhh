import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Ventana de registro retroactivo (días hábiles) — alcanzable por CUALQUIER
 * usuario autenticado (no solo Administrador), porque RetroactiveActivityModal
 * y ProjectActivitiesTab se usan en Seguimiento/Proyectos por cualquier rol.
 *
 * Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): el registro
 * retroactivo real (`tasks/[id]/activities/retroactive`) ya enforcea este
 * límite contra Django desde antes — esta lectura reflejaba hasta ahora el
 * valor de Postgres, potencialmente distinto del que de verdad se aplica.
 * La escritura de este valor (panel "Trabajo avanzado",
 * `settings/trabajo-avanzado/route.ts`) también se cortó a Django en el
 * mismo cambio, así que lectura y escritura vuelven a coincidir.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/retroactive-window/");
  if (!response || !response.ok) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  const data = (await response.json()) as { days: number };
  return NextResponse.json({ days: data.days });
}
