import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { computeSmartBenchmark, computePersonalEvolution } from "@/lib/analytics";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * Motor de Benchmarks Inteligente (§Sprint 7) — reemplaza el benchmark de
 * pares de Sprint 5. Siempre devuelve un benchmark útil (cargo/cargo-limitado/
 * personal, nunca "sin compañeros del mismo rol") más la tarjeta de Evolución
 * Personal (siempre visible, independiente del modo). Mismos permisos que el
 * resto de Analytics: propio usuario o gerencia con visibilidad sobre el rol.
 */
export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const isSelf = session.userId === userId;
  if (!isSelf && !getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const now = new Date();
  const benchmark = await computeSmartBenchmark(userId, targetUser.role, now);
  // benchmark.performance.value ES el Performance Score actual del usuario
  // (ya calculado dentro de computeSmartBenchmark) — se reutiliza en vez de
  // recalcularlo, aunque también compartiría el mismo caché `perf-bench:`.
  const evolution = await computePersonalEvolution(userId, benchmark.performance.value, now);

  return NextResponse.json({ benchmark, evolution });
}
