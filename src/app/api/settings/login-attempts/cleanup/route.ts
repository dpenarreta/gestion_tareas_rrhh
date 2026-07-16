import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { countExpiredLoginAttempts, cleanupExpiredLoginAttempts } from "@/lib/rate-limit";

/** Vista previa: cuenta los registros de LoginAttempt expirados, sin borrar nada. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const expiredCount = await countExpiredLoginAttempts();
  return NextResponse.json({ expiredCount });
}

/** Elimina los registros de LoginAttempt ya no bloqueantes con más de 30 días de antigüedad. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const deleted = await cleanupExpiredLoginAttempts();
  return NextResponse.json({ deleted });
}
