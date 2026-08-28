import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Bloque "Predictivo" de Reportes Ejecutivos — Fase 85 de la migración de
 * stack (ver docs/AUDIT_LOG.md § 2026-08-27). Reemplaza
 * `src/lib/predictionEngine.ts` (Prisma directo, vía `capacityForecast.ts`/
 * `trendEngine.ts`/`analyticsAuditHistory.ts`/partes de `analytics.ts`) —
 * verificado función por función que Django ya calcula EXACTAMENTE lo
 * mismo desde las Fases 4f/9a/9b, expuesto en vivo desde la Fase 48
 * (`/inteligencia-preventiva`). No se porta ni recalcula nada — se reusa.
 *
 * `GET /predictive/predictions/<id>/` cubre Cumplimiento+Sobrecarga para
 * UN colaborador — ya trae `?as_of=` (agregado en esta misma fase, antes
 * solo aceptaba "ahora"). Subutilización necesita un roster EXPLÍCITO
 * (no el equipo jerárquico del actor, que es lo que sirve el endpoint GET
 * ya existente) — nueva vista batch en `apps.reports`,
 * `POST /reports/executive/team-subutilization/`.
 */

export type PredictionHorizon = 7 | 15 | 30 | 90;

export type CumplimientoProjection =
  | { available: false; reason: string }
  | {
      available: true;
      horizon: PredictionHorizon;
      confidencePct: number;
      cumplimientoEsperadoCierrePct: number;
      queOcurrira: string;
      porQue: string;
      queHacer: string[];
    };

export type SobrecargaPrediction =
  | { available: false; reason: string }
  | {
      available: true;
      horizon: PredictionHorizon;
      confidencePct: number;
      nivel: "Alto" | "Medio" | "Bajo";
      queOcurrira: string;
      porQue: string;
      queHacer: string[];
    };

export type SubutilizacionPrediction = {
  nivel: "Alto" | "Medio" | "Bajo";
  queOcurrira: string;
  queHacer: string[];
};

type DjangoExplainable = {
  horizon: PredictionHorizon;
  confidence_pct: number;
  que_ocurrira: string;
  por_que: string;
  que_hacer: string[];
};

type DjangoCumplimiento = { available: false; reason: string } | (DjangoExplainable & { available: true; cumplimiento_esperado_cierre_pct: number });
type DjangoSobrecarga = { available: false; reason: string } | (DjangoExplainable & { available: true; nivel: "Alto" | "Medio" | "Bajo" });
type DjangoSubutilizacion = DjangoExplainable & { nivel: "Alto" | "Medio" | "Bajo" };

function mapCumplimiento(d: DjangoCumplimiento): CumplimientoProjection {
  if (!d.available) return { available: false, reason: d.reason };
  return {
    available: true,
    horizon: d.horizon,
    confidencePct: d.confidence_pct,
    cumplimientoEsperadoCierrePct: d.cumplimiento_esperado_cierre_pct,
    queOcurrira: d.que_ocurrira,
    porQue: d.por_que,
    queHacer: d.que_hacer,
  };
}

function mapSobrecarga(d: DjangoSobrecarga): SobrecargaPrediction {
  if (!d.available) return { available: false, reason: d.reason };
  return {
    available: true,
    horizon: d.horizon,
    confidencePct: d.confidence_pct,
    nivel: d.nivel,
    queOcurrira: d.que_ocurrira,
    porQue: d.por_que,
    queHacer: d.que_hacer,
  };
}

/** `null` si Django no está disponible o el colaborador no es visible para la sesión que genera el reporte. */
export async function fetchDjangoPredictionBundle(
  djangoUserId: number,
  asOf: Date
): Promise<{ cumplimiento: CumplimientoProjection; sobrecarga: SobrecargaPrediction } | null> {
  const response = await djangoApiFetch(`/predictive/predictions/${djangoUserId}/?as_of=${encodeURIComponent(asOf.toISOString())}`);
  if (!response || !response.ok) return null;

  const data = (await response.json()) as { cumplimiento: DjangoCumplimiento; sobrecarga: DjangoSobrecarga };
  return { cumplimiento: mapCumplimiento(data.cumplimiento), sobrecarga: mapSobrecarga(data.sobrecarga) };
}

/** Vacío si Django no está disponible — mismo criterio que el resto de esta migración (nunca lanza). */
export async function fetchDjangoTeamSubutilization(djangoUserIds: number[], asOf: Date): Promise<Map<number, SubutilizacionPrediction>> {
  const result = new Map<number, SubutilizacionPrediction>();
  if (djangoUserIds.length === 0) return result;

  const response = await djangoApiFetch("/reports/executive/team-subutilization/", {
    method: "POST",
    body: JSON.stringify({ user_ids: djangoUserIds, as_of: asOf.toISOString() }),
  });
  if (!response || !response.ok) return result;

  const data = (await response.json()) as { predictions: Record<string, DjangoSubutilizacion> };
  for (const [key, value] of Object.entries(data.predictions)) {
    result.set(Number(key), { nivel: value.nivel, queOcurrira: value.que_ocurrira, queHacer: value.que_hacer });
  }
  return result;
}
