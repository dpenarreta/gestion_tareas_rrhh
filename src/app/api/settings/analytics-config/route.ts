import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import {
  ANALYTICS_CONFIG_DEFAULTS,
  getEffectiveAnalyticsConfig,
  setAnalyticsConfigValue,
  PREDICTION_MAX_DAYS,
  type AnalyticsConfigKey,
} from "@/lib/systemConfig";
import { invalidateAnalyticsCache } from "@/lib/analytics";

// Reutiliza canManageUsers (ADMINISTRADOR, JEFE_NACIONAL, COORDINADOR_NACIONAL)
// — mismo grupo de acceso pedido para "Configuración de Analytics".
const VALIDATION: Partial<Record<AnalyticsConfigKey, { min: number; max: number }>> = {
  healthWeightCumplimiento: { min: 0, max: 100 },
  healthWeightCarga: { min: 0, max: 100 },
  healthWeightVencidas: { min: 0, max: 100 },
  healthWeightConsistencia: { min: 0, max: 100 },
  healthWeightCapacidad: { min: 0, max: 100 },
  riskWeightSobrecarga: { min: 0, max: 100 },
  riskWeightVencidasCriticas: { min: 0, max: 100 },
  riskWeightTendenciaNegativa: { min: 0, max: 100 },
  riskWeightHorasExtra: { min: 0, max: 100 },
  riskWeightBajaCapacidad: { min: 0, max: 100 },
  riskWeightVariabilidad: { min: 0, max: 100 },
  riskWeightConcentracion: { min: 0, max: 100 },
  riskWeightSinPlanificacion: { min: 0, max: 100 },
  riskThresholdMedio: { min: 1, max: 99 },
  riskThresholdAlto: { min: 1, max: 99 },
  riskThresholdCritico: { min: 1, max: 100 },
  alertOverdueTaskThreshold: { min: 1, max: 50 },
  alertConsecutiveOverloadDays: { min: 1, max: 30 },
  anomalyVariationThresholdPct: { min: 5, max: 200 },
  cacheTtlMinutes: { min: 1, max: 1440 },
  predictionMinWeeksMedia: { min: 1, max: 10 },
  predictionMinWeeksAlta: { min: 1, max: 20 },
};

const HEALTH_WEIGHT_KEYS: AnalyticsConfigKey[] = [
  "healthWeightCumplimiento",
  "healthWeightCarga",
  "healthWeightVencidas",
  "healthWeightConsistencia",
  "healthWeightCapacidad",
];
const RISK_WEIGHT_KEYS: AnalyticsConfigKey[] = [
  "riskWeightSobrecarga",
  "riskWeightVencidasCriticas",
  "riskWeightTendenciaNegativa",
  "riskWeightHorasExtra",
  "riskWeightBajaCapacidad",
  "riskWeightVariabilidad",
  "riskWeightConcentracion",
  "riskWeightSinPlanificacion",
];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const config = await getEffectiveAnalyticsConfig();
  return NextResponse.json({ config, defaults: ANALYTICS_CONFIG_DEFAULTS, predictionMaxDays: PREDICTION_MAX_DAYS });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: Partial<Record<AnalyticsConfigKey, number>>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const entries = Object.entries(body) as [AnalyticsConfigKey, number][];
  if (entries.length === 0) return NextResponse.json({ error: "Nada que guardar" }, { status: 400 });

  for (const [key, value] of entries) {
    const rule = VALIDATION[key];
    if (!rule) return NextResponse.json({ error: `Clave de configuración desconocida: ${key}` }, { status: 400 });
    if (typeof value !== "number" || !Number.isFinite(value) || value < rule.min || value > rule.max) {
      return NextResponse.json({ error: `${key} debe ser un número entre ${rule.min} y ${rule.max}` }, { status: 400 });
    }
  }

  const current = await getEffectiveAnalyticsConfig();
  const merged = { ...current, ...body };

  const healthSum = HEALTH_WEIGHT_KEYS.reduce((s, k) => s + merged[k], 0);
  if (HEALTH_WEIGHT_KEYS.some((k) => k in body) && Math.round(healthSum) !== 100) {
    return NextResponse.json({ error: `Las ponderaciones del Score de Salud deben sumar 100 (suman ${healthSum})` }, { status: 400 });
  }
  const riskSum = RISK_WEIGHT_KEYS.reduce((s, k) => s + merged[k], 0);
  if (RISK_WEIGHT_KEYS.some((k) => k in body) && Math.round(riskSum) !== 100) {
    return NextResponse.json({ error: `Las ponderaciones del Índice de Riesgo Operativo deben sumar 100 (suman ${riskSum})` }, { status: 400 });
  }
  if (!(merged.riskThresholdMedio < merged.riskThresholdAlto && merged.riskThresholdAlto < merged.riskThresholdCritico)) {
    return NextResponse.json({ error: "Los umbrales de riesgo deben cumplir Medio < Alto < Crítico" }, { status: 400 });
  }

  await Promise.all(entries.map(([key, value]) => setAnalyticsConfigValue(key, value, session.userId)));
  invalidateAnalyticsCache();

  const updated = await getEffectiveAnalyticsConfig();
  return NextResponse.json({ config: updated });
}
