import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { computeTeamCapacityForecast, classifyCapacity, type CapacityForecast } from "@/lib/capacityForecast";

type CapacitySnapshot = { capacidadDisponiblePct: number; capacidadDisponibleHoras: number; estado: string };

function simulate(cap: CapacityForecast, deltaComprometido: number): CapacitySnapshot {
  const newComprometido = Math.max(0, Math.round((cap.comprometidoFuturo + deltaComprometido) * 100) / 100);
  const newDisponible = Math.round((cap.baseFuturaTotal - newComprometido) * 100) / 100;
  const newDisponiblePct = cap.baseFuturaTotal > 0 ? Math.round((newDisponible / cap.baseFuturaTotal) * 100) : 0;
  const cls = classifyCapacity(newDisponible, cap.baseFuturaTotal, newDisponiblePct);
  return { capacidadDisponiblePct: newDisponiblePct, capacidadDisponibleHoras: newDisponible, estado: cls.estado };
}

/**
 * Simulador — escenario "redistribuir carga" (Bloque 8), bi-usuario. No
 * encaja en `/api/analytics/simulate/[userId]` (contrato de un solo usuario,
 * protegido esta sesión) — ruta nueva, reutiliza `computeTeamCapacityForecast`/
 * `classifyCapacity` (ya exportadas). Nunca persiste nada.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { fromUserId, toUserId, hours } = (body ?? {}) as { fromUserId?: string; toUserId?: string; hours?: number };
  if (!fromUserId || !toUserId || fromUserId === toUserId || typeof hours !== "number" || hours <= 0 || hours > 200) {
    return NextResponse.json({ error: "Escenario inválido" }, { status: 400 });
  }

  const users = await prisma.user.findMany({ where: { id: { in: [fromUserId, toUserId] } }, select: { id: true, role: true } });
  if (users.length !== 2) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  const visible = getVisibleRoles(session.role);
  const authorized = users.every((u) => session.userId === u.id || visible.includes(u.role));
  if (!authorized) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const now = new Date();
  const capacityMap = await computeTeamCapacityForecast([fromUserId, toUserId], now);
  const fromCap = capacityMap.get(fromUserId)!;
  const toCap = capacityMap.get(toUserId)!;

  const fromBefore: CapacitySnapshot = { capacidadDisponiblePct: fromCap.disponiblePct, capacidadDisponibleHoras: fromCap.disponible, estado: fromCap.estado };
  const toBefore: CapacitySnapshot = { capacidadDisponiblePct: toCap.disponiblePct, capacidadDisponibleHoras: toCap.disponible, estado: toCap.estado };

  return NextResponse.json({
    from: { userId: fromUserId, before: fromBefore, after: simulate(fromCap, -hours) },
    to: { userId: toUserId, before: toBefore, after: simulate(toCap, hours) },
    scenario: { type: "redistribute_load", fromUserId, toUserId, hours },
  });
}
