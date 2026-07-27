import "server-only";
import { prisma } from "@/lib/prisma";
import { computeTrendEngine, type TrendDataPoint, type TrendIndicator } from "@/lib/trendEngine";
import { computeSobrecargaProbability, computeSubutilizacionPredictions, computeProjectDelayPrediction, computeOperationalStability } from "@/lib/predictionEngine";

/**
 * Inteligencia Preventiva (Sprint E, Bloque 7) — compone las salidas YA
 * CALCULADAS de trendEngine.ts/predictionEngine.ts en una lista priorizada
 * de alertas legibles. Explícitamente SEPARADA de `computeAlerts`
 * (analytics.ts, motor de 8 reglas) y de `riskAlerts.ts` (vestigial) —
 * ninguno de los dos se importa para mutar ni se toca.
 */
export type PreventiveSeverity = "roja" | "naranja" | "amarilla" | "verde";

export type PreventiveAlert = {
  severity: PreventiveSeverity;
  message: string;
  source: string;
  relatedIndicator: TrendIndicator | "sobrecarga" | "subutilizacion" | "retraso" | "estabilidad";
};

const SEVERITY_RANK: Record<PreventiveSeverity, number> = { roja: 4, naranja: 3, amarilla: 2, verde: 1 };

function sortBySeverity(alerts: PreventiveAlert[]): PreventiveAlert[] {
  return alerts.slice().sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** Semanas consecutivas (desde la más reciente hacia atrás) en que el valor bajó respecto a la anterior. */
function consecutiveDeclineWeeks(points: TrendDataPoint[]): number {
  let streak = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].value < points[i - 1].value) streak++;
    else break;
  }
  return streak > 0 ? streak + 1 : 0; // +1: el streak cuenta caídas, la "semana" incluye el punto de partida.
}

const ORDINAL: Record<number, string> = { 1: "primera", 2: "segunda", 3: "tercera", 4: "cuarta", 5: "quinta" };

export async function computePreventiveAlerts(userId: string, now: Date = new Date()): Promise<PreventiveAlert[]> {
  const [sobrecarga, trend, stability, subutilizacionMap] = await Promise.all([
    computeSobrecargaProbability(userId, now),
    computeTrendEngine(userId, now),
    computeOperationalStability(userId, now),
    computeSubutilizacionPredictions([userId], now),
  ]);

  const alerts: PreventiveAlert[] = [];

  if (sobrecarga.available && sobrecarga.nivel !== "Bajo") {
    alerts.push({
      severity: sobrecarga.nivel === "Alto" ? "roja" : "naranja",
      message:
        sobrecarga.horizon <= 7
          ? `Existe ${sobrecarga.nivel === "Alto" ? "alta" : "media"} probabilidad de sobrecarga la próxima semana.`
          : `Existe ${sobrecarga.nivel === "Alto" ? "alta" : "media"} probabilidad de sobrecarga en los próximos ${sobrecarga.horizon} días.`,
      source: "Predicción de Sobrecarga",
      relatedIndicator: "sobrecarga",
    });
  }

  const cumplimiento = trend.indicators.cumplimiento;
  if (cumplimiento.available && cumplimiento.direction === "negativa") {
    const streak = consecutiveDeclineWeeks(cumplimiento.dataPoints);
    if (streak >= 2) {
      alerts.push({
        severity: streak >= 3 ? "roja" : "naranja",
        message: `La tendencia de cumplimiento disminuye por ${ORDINAL[Math.min(streak, 5)] ?? `${streak}ª`} semana consecutiva.`,
        source: "Trend Engine — Cumplimiento",
        relatedIndicator: "cumplimiento",
      });
    }
  }

  const subutilizacion = subutilizacionMap.get(userId);
  if (subutilizacion && subutilizacion.nivel === "Alto") {
    alerts.push({
      severity: "amarilla",
      message: "Presenta una proyección de subutilización de capacidad.",
      source: "Predicción de Subutilización",
      relatedIndicator: "subutilizacion",
    });
  }

  if (stability.classification === "Baja" || stability.classification === "Muy Baja") {
    alerts.push({
      severity: stability.classification === "Muy Baja" ? "naranja" : "amarilla",
      message: `Estabilidad operativa ${stability.classification.toLowerCase()} — variabilidad significativa en: ${stability.basedOn.join(", ") || "varios indicadores"}.`,
      source: "Estabilidad Operativa",
      relatedIndicator: "estabilidad",
    });
  }

  if (alerts.length === 0) {
    return [{ severity: "verde", message: "Sin riesgos preventivos detectados.", source: "Inteligencia Preventiva", relatedIndicator: "estabilidad" }];
  }
  return sortBySeverity(alerts);
}

/**
 * Vista de equipo — mismos bloques de predicción, en lote (batch de
 * `computeSubutilizacionPredictions` ya evita N+1; `computeProjectDelayPrediction`
 * se llama una vez por proyecto visible, no por participante).
 */
export async function computeTeamPreventiveAlerts(userIds: string[], projectIds: string[], now: Date = new Date()): Promise<PreventiveAlert[]> {
  const [subutilizacionMap, users, projectDelays, projects] = await Promise.all([
    computeSubutilizacionPredictions(userIds, now),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    Promise.all(projectIds.map((id) => computeProjectDelayPrediction(id, now))),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const alerts: PreventiveAlert[] = [];

  for (const [userId, prediction] of subutilizacionMap) {
    if (prediction.nivel === "Alto") {
      alerts.push({
        severity: "amarilla",
        message: `${userName.get(userId) ?? "Un colaborador"} presenta una proyección de subutilización.`,
        source: "Predicción de Subutilización",
        relatedIndicator: "subutilizacion",
      });
    }
  }

  projectIds.forEach((projectId, i) => {
    const prediction = projectDelays[i];
    if (prediction.available && prediction.nivel !== "Bajo") {
      alerts.push({
        severity: prediction.nivel === "Alto" ? "roja" : "naranja",
        message: `Existe riesgo ${prediction.nivel === "Alto" ? "elevado" : "moderado"} de retraso en ${projectName.get(projectId) ?? "un proyecto"}.`,
        source: "Predicción de Retrasos",
        relatedIndicator: "retraso",
      });
    }
  });

  if (alerts.length === 0) {
    return [{ severity: "verde", message: "Sin riesgos preventivos detectados en el equipo.", source: "Inteligencia Preventiva", relatedIndicator: "estabilidad" }];
  }
  return sortBySeverity(alerts);
}
