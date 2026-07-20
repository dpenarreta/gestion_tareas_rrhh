import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { businessCalendarDay } from "@/lib/businessTime";
import { monthlyBusinessBase, computeWorkloadRange, computeWorkloadPct, computeCargaTiempo } from "@/lib/workload";
import { computeCapacityForecast, classifyCapacity } from "@/lib/capacityForecast";
import { getEffectiveHorasEfectivas } from "@/lib/systemConfig";
import { computeHealthScore, computeMonthlyHistory } from "@/lib/analytics";
import type { WorkloadColor, WorkloadLabel } from "@/components/kpis/types";

type Ctx = { params: Promise<{ userId: string }> };

type Scenario =
  | { type: "assign_task"; hours: number }
  | { type: "daily_hours"; newHoursPerDay: number }
  | { type: "vacation"; days: number }
  | { type: "permiso"; hours: number };

type Snapshot = {
  cargaPct: number;
  cargaLabel: WorkloadLabel;
  cargaColor: WorkloadColor;
  capacidadDisponiblePct: number;
  capacidadDisponibleHoras: number;
  cumplimientoPct: number;
  healthScore: number;
  healthClassification: string;
};

function isValidScenario(body: unknown): body is Scenario {
  if (typeof body !== "object" || body === null || !("type" in body)) return false;
  const b = body as Record<string, unknown>;
  switch (b.type) {
    case "assign_task": return typeof b.hours === "number" && b.hours > 0 && b.hours < 1000;
    case "daily_hours": return typeof b.newHoursPerDay === "number" && b.newHoursPerDay > 0 && b.newHoursPerDay <= 24;
    case "vacation": return typeof b.days === "number" && b.days > 0 && b.days <= 60;
    case "permiso": return typeof b.hours === "number" && b.hours > 0 && b.hours < 200;
    default: return false;
  }
}

/**
 * Simuladores interactivos (§9) — NO persisten nada, solo recalculan en
 * memoria a partir del estado real actual usando las MISMAS fórmulas del
 * motor (computeWorkloadRange/computeWorkloadPct/classifyCapacity), con el
 * escenario hipotético aplicado como un ajuste aritmético sobre las horas
 * base/comprometidas — nunca se escribe en la base de datos.
 */
export async function POST(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  const isSelf = session.userId === userId;
  if (!isSelf && !getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!isValidScenario(body)) return NextResponse.json({ error: "Escenario inválido" }, { status: 400 });

  const now = new Date();
  const today = businessCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  const [biz, hoursPerDay, cargaTiempo, capacity, healthScore, monthlyPoint] = await Promise.all([
    monthlyBusinessBase(year, month),
    getEffectiveHorasEfectivas(now),
    computeCargaTiempo(userId, now),
    computeCapacityForecast(userId, now),
    computeHealthScore(userId, now),
    computeMonthlyHistory(userId, 1, now).then((h) => h[0]),
  ]);

  const before: Snapshot = {
    cargaPct: cargaTiempo.mensual.pct,
    cargaLabel: cargaTiempo.mensual.label,
    cargaColor: cargaTiempo.mensual.color,
    capacidadDisponiblePct: capacity.disponiblePct,
    capacidadDisponibleHoras: capacity.disponible,
    cumplimientoPct: monthlyPoint.completedPct,
    healthScore: healthScore.score,
    healthClassification: healthScore.classification,
  };

  // Factor "Capacidad futura" y "Carga laboral" del Score de Salud — se
  // recalculan con el escenario aplicado y se reinsertan en la suma total,
  // sin volver a consultar el resto de factores (no cambian en ningún escenario).
  const capacityFactor = healthScore.factors.find((f) => f.name === "Capacidad futura")!;
  const cargaFactor = healthScore.factors.find((f) => f.name === "Carga laboral")!;
  const otherFactorsPoints = healthScore.factors.filter((f) => f.name !== "Capacidad futura" && f.name !== "Carga laboral").reduce((s, f) => s + f.points, 0);

  function capacityScoreFor(estado: string, disponiblePct: number): number {
    if (estado === "alta" || estado === "limitada" || estado === "sin-planificacion") return estado === "alta" ? 100 : 70;
    return disponiblePct < 0 ? 0 : 40;
  }
  function cargaScoreFor(realHours: number, baseHours: number, limitHighHours: number, limitOverloadHours: number): number {
    if (baseHours <= 0) return 100;
    if (realHours >= baseHours && realHours <= limitHighHours) return 100;
    if (realHours < baseHours) return Math.round(Math.max(0, Math.min(100, (realHours / baseHours) * 100)));
    const overBy = realHours - limitHighHours;
    const span = Math.max((limitOverloadHours - limitHighHours) * 2, 1);
    return Math.round(Math.max(0, 100 - (overBy / span) * 100));
  }
  function recombinePoints(newCapacityPoints: number, newCargaPoints: number): { score: number; classification: string } {
    const score = Math.round((otherFactorsPoints + newCapacityPoints + newCargaPoints) * 100) / 100;
    const classification = score >= 90 ? "Excelente" : score >= 75 ? "Bueno" : score >= 60 ? "Riesgo" : "Crítico";
    return { score, classification };
  }
  function pointsFor(score: number, weight: number): number {
    return Math.round(((score * weight) / 100) * 100) / 100;
  }

  let after: Snapshot;

  if (body.type === "assign_task") {
    const newDisponible = Math.round((capacity.disponible - body.hours) * 100) / 100;
    const newDisponiblePct = capacity.baseFuturaTotal > 0 ? Math.round((newDisponible / capacity.baseFuturaTotal) * 100) : 0;
    const cls = classifyCapacity(newDisponible, capacity.baseFuturaTotal, newDisponiblePct);
    const newCapacityScore = capacityScoreFor(cls.estado, newDisponiblePct);
    // La carga laboral (horas ya trabajadas este mes) no cambia al asignar una
    // tarea nueva todavía sin iniciar — se conserva el puntaje de carga actual.
    const { score, classification } = recombinePoints(pointsFor(newCapacityScore, capacityFactor.weight), cargaFactor.points);
    after = {
      ...before,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      healthScore: score,
      healthClassification: classification,
    };
  } else if (body.type === "daily_hours") {
    const ratio = hoursPerDay > 0 ? body.newHoursPerDay / hoursPerDay : 1;
    const newBaseHours = Math.round(biz.limitBaseHours * ratio * 100) / 100;
    const newLimitLow = biz.limitLowHours * ratio;
    const newLimitHigh = biz.limitHighHours * ratio;
    const newLimitOverload = biz.limitOverloadHours * ratio;
    const range = computeWorkloadRange(cargaTiempo.mensual.realHours, newBaseHours, newLimitLow, newLimitHigh, newLimitOverload);
    const pct = computeWorkloadPct(cargaTiempo.mensual.realHours, newBaseHours, range.max);

    const newBaseFuturaTotal = Math.round(capacity.baseFuturaTotal * ratio * 100) / 100;
    const newDisponible = Math.round((newBaseFuturaTotal - capacity.comprometidoFuturo) * 100) / 100;
    const newDisponiblePct = newBaseFuturaTotal > 0 ? Math.round((newDisponible / newBaseFuturaTotal) * 100) : 0;
    const cls = classifyCapacity(newDisponible, newBaseFuturaTotal, newDisponiblePct);

    const newCargaScore = cargaScoreFor(cargaTiempo.mensual.realHours, newBaseHours, newLimitHigh, newLimitOverload);
    const newCapacityScore = capacityScoreFor(cls.estado, newDisponiblePct);
    const { score, classification } = recombinePoints(pointsFor(newCapacityScore, capacityFactor.weight), pointsFor(newCargaScore, cargaFactor.weight));

    after = {
      cargaPct: pct,
      cargaLabel: range.label,
      cargaColor: range.color,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      cumplimientoPct: before.cumplimientoPct,
      healthScore: score,
      healthClassification: classification,
    };
  } else if (body.type === "vacation") {
    const reduction = Math.round(body.days * hoursPerDay * 100) / 100;
    const newBaseFuturaTotal = Math.max(0, Math.round((capacity.baseFuturaTotal - reduction) * 100) / 100);
    const newDisponible = Math.round((newBaseFuturaTotal - capacity.comprometidoFuturo) * 100) / 100;
    const newDisponiblePct = newBaseFuturaTotal > 0 ? Math.round((newDisponible / newBaseFuturaTotal) * 100) : 0;
    const cls = classifyCapacity(newDisponible, newBaseFuturaTotal, newDisponiblePct);
    const newCapacityScore = capacityScoreFor(cls.estado, newDisponiblePct);
    // Las vacaciones futuras no modifican las horas ya trabajadas este mes — el puntaje de carga se conserva.
    const { score, classification } = recombinePoints(pointsFor(newCapacityScore, capacityFactor.weight), cargaFactor.points);
    after = {
      ...before,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      healthScore: score,
      healthClassification: classification,
    };
  } else {
    // permiso: reduce tanto la base mensual de carga (menos horas objetivo este mes) como la capacidad futura restante.
    const newBaseHours = Math.max(0, Math.round((biz.limitBaseHours - body.hours) * 100) / 100);
    const newLimitHigh = Math.max(0, biz.limitHighHours - body.hours);
    const newLimitOverload = Math.max(0, biz.limitOverloadHours - body.hours);
    const range = computeWorkloadRange(cargaTiempo.mensual.realHours, newBaseHours, Math.max(0, biz.limitLowHours - body.hours), newLimitHigh, newLimitOverload);
    const pct = computeWorkloadPct(cargaTiempo.mensual.realHours, newBaseHours, range.max);

    const newBaseFuturaTotal = Math.max(0, Math.round((capacity.baseFuturaTotal - body.hours) * 100) / 100);
    const newDisponible = Math.round((newBaseFuturaTotal - capacity.comprometidoFuturo) * 100) / 100;
    const newDisponiblePct = newBaseFuturaTotal > 0 ? Math.round((newDisponible / newBaseFuturaTotal) * 100) : 0;
    const cls = classifyCapacity(newDisponible, newBaseFuturaTotal, newDisponiblePct);

    const newCargaScore = cargaScoreFor(cargaTiempo.mensual.realHours, newBaseHours, newLimitHigh, newLimitOverload);
    const newCapacityScore = capacityScoreFor(cls.estado, newDisponiblePct);
    const { score, classification } = recombinePoints(pointsFor(newCapacityScore, capacityFactor.weight), pointsFor(newCargaScore, cargaFactor.weight));

    after = {
      cargaPct: pct,
      cargaLabel: range.label,
      cargaColor: range.color,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      cumplimientoPct: before.cumplimientoPct,
      healthScore: score,
      healthClassification: classification,
    };
  }

  return NextResponse.json({ before, after, scenario: body });
}
