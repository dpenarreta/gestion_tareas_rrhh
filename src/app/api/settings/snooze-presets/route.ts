import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getEffectiveSnoozePresetsMinutes } from "@/lib/systemConfig";

/**
 * Presets de posposición de recordatorios (minutos) — alcanzable por
 * CUALQUIER usuario autenticado (Escritorio Digital lo usa cualquier rol no
 * Administrador). `systemConfig.ts` es "server-only", de ahí el endpoint.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const minutes = await getEffectiveSnoozePresetsMinutes();
  return NextResponse.json({ minutes });
}
