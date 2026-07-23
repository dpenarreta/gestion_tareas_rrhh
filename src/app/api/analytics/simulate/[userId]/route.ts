import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";
import { businessCalendarDay } from "@/lib/businessTime";
import { monthlyBusinessBase, computeWorkloadRange, computeWorkloadPct, computeCargaTiempo } from "@/lib/workload";
import { computeCapacityForecast, classifyCapacity } from "@/lib/capacityForecast";
import { getEffectiveHorasEfectivas, getEffectiveCurve } from "@/lib/systemConfig";
import { computeHealthScore, computeMonthlyHistory, computePerformanceScore, classifyPerformanceScore, capacityToScore, cargaHealthScore, weightedPoints } from "@/lib/analytics";
import { normalize } from "@/lib/normalizationEngine";
import type { WorkloadColor, WorkloadLabel } from "@/components/kpis/types";

type Ctx = { params: Promise<{ userId: string }> };

type Scenario =
  | { type: "assign_task"; hours: number }
  | { type: "daily_hours"; newHoursPerDay: number }
  | { type: "vacation"; days: number }
  | { type: "permiso"; hours: number }
  | { type: "register_hours"; hours: number }
  | { type: "complete_task"; count: number }
  | { type: "reduce_overdue"; count: number; alta: number }
  | { type: "increase_consistency"; deltaPoints: number };

type Snapshot = {
  cargaPct: number;
  cargaLabel: WorkloadLabel;
  cargaColor: WorkloadColor;
  capacidadDisponiblePct: number;
  capacidadDisponibleHoras: number;
  cumplimientoPct: number;
  healthScore: number;
  healthClassification: string;
  performanceScorePts: number;
  performanceScoreClass: string;
};

function isValidScenario(body: unknown): body is Scenario {
  if (typeof body !== "object" || body === null || !("type" in body)) return false;
  const b = body as Record<string, unknown>;
  switch (b.type) {
    case "assign_task": return typeof b.hours === "number" && b.hours > 0 && b.hours < 1000;
    case "daily_hours": return typeof b.newHoursPerDay === "number" && b.newHoursPerDay > 0 && b.newHoursPerDay <= 24;
    case "vacation": return typeof b.days === "number" && b.days > 0 && b.days <= 60;
    case "permiso": return typeof b.hours === "number" && b.hours > 0 && b.hours < 200;
    case "register_hours": return typeof b.hours === "number" && b.hours > 0 && b.hours < 200;
    case "complete_task": return typeof b.count === "number" && b.count > 0 && b.count <= 50;
    case "reduce_overdue": return typeof b.count === "number" && b.count > 0 && b.count <= 50 && typeof b.alta === "number" && b.alta >= 0 && b.alta <= b.count;
    case "increase_consistency": return typeof b.deltaPoints === "number" && b.deltaPoints > 0 && b.deltaPoints <= 100;
    default: return false;
  }
}

/**
 * Simuladores interactivos (§9, ampliado en Sprint A) — NO persisten nada,
 * solo recalculan en memoria a partir del estado real actual usando las
 * MISMAS funciones puras del motor (computeWorkloadRange/computeWorkloadPct/
 * classifyCapacity/normalize/weightedPoints/classifyPerformanceScore), con el
 * escenario hipotético aplicado como un ajuste aritmético — nunca se escribe
 * en la base de datos. Los 4 escenarios originales (asign_task/daily_hours/
 * vacation/permiso) solo afectan Carga/Capacidad/Score de Salud, por diseño
 * el Performance Score no pondera horas ni capacidad — se mantiene idéntico
 * al valor real en esos casos (no es un error, es la separación de
 * responsabilidades ya documentada en computePerformanceScore). Los 4
 * escenarios nuevos (Sprint A) afectan Performance Score recalculando UN SOLO
 * factor con la curva/peso reales, dejando los otros 3 intactos.
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

  const [biz, hoursPerDay, cargaTiempo, capacity, healthScore, monthlyPoint, performanceScore] = await Promise.all([
    monthlyBusinessBase(year, month),
    getEffectiveHorasEfectivas(now),
    computeCargaTiempo(userId, now),
    computeCapacityForecast(userId, now),
    computeHealthScore(userId, now),
    computeMonthlyHistory(userId, 1, now).then((h) => h[0]),
    computePerformanceScore(userId, now),
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
    performanceScorePts: performanceScore.score,
    performanceScoreClass: performanceScore.classification,
  };

  // Factor "Capacidad futura" y "Carga laboral" del Score de Salud — se
  // recalculan con el escenario aplicado y se reinsertan en la suma total,
  // sin volver a consultar el resto de factores (no cambian en ningún escenario).
  const capacityFactor = healthScore.factors.find((f) => f.name === "Capacidad futura")!;
  const cargaFactor = healthScore.factors.find((f) => f.name === "Carga laboral")!;
  const otherHealthFactorsPoints = healthScore.factors.filter((f) => f.name !== "Capacidad futura" && f.name !== "Carga laboral").reduce((s, f) => s + f.points, 0);

  // Reutiliza las MISMAS funciones del motor (capacityToScore/cargaHealthScore/
  // weightedPoints en analytics.ts) — antes había copias locales que podían
  // desincronizarse (ver Sprint 4 § S4-B single source of truth; weightedPoints
  // extraída para este mismo propósito, ver Analytics Calculation Registry § D8).
  function recombineHealthPoints(newCapacityPoints: number, newCargaPoints: number): { score: number; classification: string } {
    const score = Math.round((otherHealthFactorsPoints + newCapacityPoints + newCargaPoints) * 100) / 100;
    const classification = score >= 90 ? "Excelente" : score >= 75 ? "Bueno" : score >= 60 ? "Riesgo" : "Crítico";
    return { score, classification };
  }

  // Sprint A — recalcula UN factor de Performance Score con la curva/peso
  // reales (normalize/weightedPoints, iguales a computePerformanceScore) y lo
  // recombina con los otros 3 factores YA calculados, sin tocarlos.
  async function recombinePerformancePoints(factorName: string, newRawValue: number): Promise<{ score: number; classification: string }> {
    const factor = performanceScore.factors.find((f) => f.name === factorName)!;
    const curvePoints = await getEffectiveCurve(factor.curve, now);
    const newNormalized = normalize(factor.curve, newRawValue, curvePoints);
    const newPoints = weightedPoints(newNormalized, factor.weight);
    const otherPerfFactorsPoints = performanceScore.factors.filter((f) => f.name !== factorName).reduce((s, f) => s + f.points, 0);
    const score = Math.round((otherPerfFactorsPoints + newPoints) * 100) / 100;
    const { classification } = classifyPerformanceScore(score);
    return { score, classification };
  }

  let after: Snapshot;

  if (body.type === "assign_task") {
    const newDisponible = Math.round((capacity.disponible - body.hours) * 100) / 100;
    const newDisponiblePct = capacity.baseFuturaTotal > 0 ? Math.round((newDisponible / capacity.baseFuturaTotal) * 100) : 0;
    const cls = classifyCapacity(newDisponible, capacity.baseFuturaTotal, newDisponiblePct);
    const newCapacityScore = capacityToScore(cls.estado, newDisponiblePct);
    // La carga laboral (horas ya trabajadas este mes) no cambia al asignar una
    // tarea nueva todavía sin iniciar — se conserva el puntaje de carga actual.
    const { score, classification } = recombineHealthPoints(weightedPoints(newCapacityScore, capacityFactor.weight), cargaFactor.points);
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

    const newCargaScore = cargaHealthScore(cargaTiempo.mensual.realHours, newBaseHours, newLimitHigh, newLimitOverload);
    const newCapacityScore = capacityToScore(cls.estado, newDisponiblePct);
    const { score, classification } = recombineHealthPoints(weightedPoints(newCapacityScore, capacityFactor.weight), weightedPoints(newCargaScore, cargaFactor.weight));

    after = {
      ...before,
      cargaPct: pct,
      cargaLabel: range.label,
      cargaColor: range.color,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      healthScore: score,
      healthClassification: classification,
    };
  } else if (body.type === "vacation") {
    const reduction = Math.round(body.days * hoursPerDay * 100) / 100;
    const newBaseFuturaTotal = Math.max(0, Math.round((capacity.baseFuturaTotal - reduction) * 100) / 100);
    const newDisponible = Math.round((newBaseFuturaTotal - capacity.comprometidoFuturo) * 100) / 100;
    const newDisponiblePct = newBaseFuturaTotal > 0 ? Math.round((newDisponible / newBaseFuturaTotal) * 100) : 0;
    const cls = classifyCapacity(newDisponible, newBaseFuturaTotal, newDisponiblePct);
    const newCapacityScore = capacityToScore(cls.estado, newDisponiblePct);
    // Las vacaciones futuras no modifican las horas ya trabajadas este mes — el puntaje de carga se conserva.
    const { score, classification } = recombineHealthPoints(weightedPoints(newCapacityScore, capacityFactor.weight), cargaFactor.points);
    after = {
      ...before,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      healthScore: score,
      healthClassification: classification,
    };
  } else if (body.type === "permiso") {
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

    const newCargaScore = cargaHealthScore(cargaTiempo.mensual.realHours, newBaseHours, newLimitHigh, newLimitOverload);
    const newCapacityScore = capacityToScore(cls.estado, newDisponiblePct);
    const { score, classification } = recombineHealthPoints(weightedPoints(newCapacityScore, capacityFactor.weight), weightedPoints(newCargaScore, cargaFactor.weight));

    after = {
      ...before,
      cargaPct: pct,
      cargaLabel: range.label,
      cargaColor: range.color,
      capacidadDisponiblePct: newDisponiblePct,
      capacidadDisponibleHoras: newDisponible,
      healthScore: score,
      healthClassification: classification,
    };
  } else if (body.type === "register_hours") {
    // Horas adicionales YA trabajadas este mes — sube la Carga Laboral real,
    // no cambia la capacidad futura (eso es proyección hacia adelante) ni el
    // Performance Score (que por diseño nunca pondera horas trabajadas).
    const newRealHours = Math.round((cargaTiempo.mensual.realHours + body.hours) * 100) / 100;
    const range = computeWorkloadRange(newRealHours, biz.limitBaseHours, biz.limitLowHours, biz.limitHighHours, biz.limitOverloadHours);
    const pct = computeWorkloadPct(newRealHours, biz.limitBaseHours, range.max);
    const newCargaScore = cargaHealthScore(newRealHours, biz.limitBaseHours, biz.limitHighHours, biz.limitOverloadHours);
    const { score, classification } = recombineHealthPoints(capacityFactor.points, weightedPoints(newCargaScore, cargaFactor.weight));
    after = {
      ...before,
      cargaPct: pct,
      cargaLabel: range.label,
      cargaColor: range.color,
      healthScore: score,
      healthClassification: classification,
    };
  } else if (body.type === "complete_task") {
    const cumplimientoFactor = performanceScore.factors.find((f) => f.name === "Cumplimiento")!;
    const totalTasks = monthlyPoint.totalTasks;
    const completed = Math.round((monthlyPoint.completedPct / 100) * totalTasks);
    const newCompletedPct = totalTasks > 0 ? Math.round((Math.min(completed + body.count, totalTasks) / totalTasks) * 100) : cumplimientoFactor.rawValue;
    const { score, classification } = await recombinePerformancePoints("Cumplimiento", newCompletedPct);
    after = { ...before, cumplimientoPct: newCompletedPct, performanceScorePts: score, performanceScoreClass: classification };
  } else if (body.type === "reduce_overdue") {
    const vencidasFactor = performanceScore.factors.find((f) => f.name === "Tareas vencidas")!;
    const reduction = body.count + body.alta; // ver Analytics Formulas §1: weightedOverdue = overdueNormal + overdueAlta×2 = count + alta
    const newWeightedOverdue = Math.max(0, Math.round((vencidasFactor.rawValue - reduction) * 100) / 100);
    const { score, classification } = await recombinePerformancePoints("Tareas vencidas", newWeightedOverdue);
    after = { ...before, performanceScorePts: score, performanceScoreClass: classification };
  } else {
    // increase_consistency
    const consistenciaFactor = performanceScore.factors.find((f) => f.name === "Consistencia")!;
    const newConsistencyRaw = Math.max(0, Math.min(100, Math.round((consistenciaFactor.rawValue + body.deltaPoints) * 10) / 10));
    const { score, classification } = await recombinePerformancePoints("Consistencia", newConsistencyRaw);
    after = { ...before, performanceScorePts: score, performanceScoreClass: classification };
  }

  const diff = {
    healthScore: Math.round((after.healthScore - before.healthScore) * 100) / 100,
    performanceScore: Math.round((after.performanceScorePts - before.performanceScorePts) * 100) / 100,
  };

  return NextResponse.json({ before, after, diff, scenario: body });
}
