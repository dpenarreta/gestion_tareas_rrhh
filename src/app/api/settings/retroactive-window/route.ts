import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getEffectiveRetroactiveWindowDays } from "@/lib/systemConfig";

/**
 * Ventana de registro retroactivo (días hábiles) — alcanzable por CUALQUIER
 * usuario autenticado (no solo Administrador), porque RetroactiveActivityModal
 * y ProjectActivitiesTab se usan en Seguimiento/Proyectos por cualquier rol.
 * `systemConfig.ts` es "server-only" y estos son componentes cliente, de ahí
 * el endpoint.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const days = await getEffectiveRetroactiveWindowDays();
  return NextResponse.json({ days });
}
