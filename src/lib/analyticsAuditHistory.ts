import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Capa complementaria de SOLO LECTURA sobre `AnalyticsAuditLog` — NO forma
 * parte del Analytics Engine (`analytics.ts`/`capacityForecast.ts`/
 * `workload.ts`/`targetTime.ts`/`normalizationEngine.ts`), que permanecen
 * como única fuente oficial de cálculo y NO se modifican para este módulo.
 *
 * Este archivo nunca recalcula un KPI: solo lee filas ya escritas por
 * `auditCalculation()` (el motor central las persiste en cada corrida, best
 * effort) y las expone en una forma útil para la capa de explicabilidad
 * (Sprint A) — explicación de tendencias y gráfico de histórico con selector
 * de período. Mismo criterio de "nunca lanza, devuelve vacío" que ya usa
 * `getScoredAuditHistory` en `analytics.ts` (no se toca esa función: existe
 * un pequeño solape de lectura entre ambas por diseño, para no tener que
 * ampliar la firma de una función del motor oficial).
 */

export type AuditKind = "performance_score" | "operational_risk" | "health_score";

export type AuditFactorSnapshot = { name: string; points: number; weight: number; rawLabel?: string; detail?: string };

export type AuditHistoryPoint = {
  createdAt: Date;
  period: string;
  score: number;
  classification?: string;
  factors: AuditFactorSnapshot[];
};

function parseAuditResult(result: unknown): { score?: number; classification?: string; factors?: AuditFactorSnapshot[] } {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  const score = typeof r.score === "number" ? r.score : undefined;
  const classification = typeof r.classification === "string" ? r.classification : undefined;
  const rawFactors = Array.isArray(r.factors) ? r.factors : [];
  const factors: AuditFactorSnapshot[] = rawFactors
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      name: typeof f.name === "string" ? f.name : "",
      points: typeof f.points === "number" ? f.points : 0,
      weight: typeof f.weight === "number" ? f.weight : 0,
      rawLabel: typeof f.rawLabel === "string" ? f.rawLabel : undefined,
      detail: typeof f.detail === "string" ? f.detail : undefined,
    }))
    .filter((f) => f.name !== "");
  return { score, classification, factors };
}

/**
 * Lee `AnalyticsAuditLog` para un `userId`/`kind` dentro de una ventana de
 * días, devolviendo score + factores tal como el motor los calculó y
 * persistió (nunca recalculado aquí). Ordenado descendente (más reciente
 * primero), igual convención que `getScoredAuditHistory`.
 */
export async function getFactorAuditHistory(userId: string, kind: AuditKind, now: Date, windowDays: number): Promise<AuditHistoryPoint[]> {
  const windowStart = new Date(now.getTime() - windowDays * 86400000);
  try {
    const entries = await prisma.analyticsAuditLog.findMany({
      where: { userId, kind, createdAt: { gte: windowStart, lt: now } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, period: true, result: true },
    });
    const points: AuditHistoryPoint[] = [];
    for (const e of entries) {
      const parsed = parseAuditResult(e.result);
      if (typeof parsed.score !== "number") continue;
      const point: AuditHistoryPoint = { createdAt: e.createdAt, period: e.period, score: parsed.score, factors: parsed.factors ?? [] };
      if (parsed.classification !== undefined) point.classification = parsed.classification;
      points.push(point);
    }
    return points;
  } catch {
    return [];
  }
}

/** El punto con factores más cercano a "hace `daysAgo` días", con tolerancia — mismo criterio que `closestScoredPoint` de `analytics.ts`, reimplementado aquí solo porque esa función devuelve únicamente el score (no los factores) y no se puede ampliar sin tocar el motor. */
export function closestFactorPoint(history: AuditHistoryPoint[], now: Date, daysAgo: number, toleranceDays = 3): AuditHistoryPoint | null {
  const target = now.getTime() - daysAgo * 86400000;
  let best: { point: AuditHistoryPoint; diff: number } | null = null;
  for (const p of history) {
    const diff = Math.abs(p.createdAt.getTime() - target);
    if (diff <= toleranceDays * 86400000 && (!best || diff < best.diff)) best = { point: p, diff };
  }
  return best?.point ?? null;
}

export type ScoreSeriesPoint = { date: string; score: number };

/** Serie {fecha, score} ascendente para gráficos de evolución — un punto por fila de auditoría (no se agrega/recalcula nada). */
export async function getScoreSeries(userId: string, kind: AuditKind, now: Date, windowDays: number): Promise<ScoreSeriesPoint[]> {
  const history = await getFactorAuditHistory(userId, kind, now, windowDays);
  return history
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((p) => ({ date: p.createdAt.toISOString(), score: p.score }));
}
