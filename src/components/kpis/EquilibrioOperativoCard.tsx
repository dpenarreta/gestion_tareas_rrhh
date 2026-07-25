"use client";

import { useState, useEffect } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import type { HealthFactor, EstadoOperativo, EstadoOperativoColor, ExcludedPeriod } from "./types";
import { HelpPopover, ScoreZoneBar, ExplainModal, ConfidenceBadges, type ExplainFactor } from "./AdvancedAnalytics";
import { ActionBlock, type Insight, type SuggestedAction } from "./InsightsPanel";
import { INDICATOR_HELP, SCORE_CLASSIFICATION_REFERENCE, type ConfidenceIndicators } from "@/lib/analyticsExplain";

// ── Tipos — reflejan GET /api/analytics/equilibrio/[userId] ─────────────────
// (server-only, no se importa directo — mismo patrón que OperationalRiskCard.tsx)

type ScoreTrendExplanation = {
  available: boolean;
  direction: "mejora" | "empeoro" | "estable";
  scoreDelta: number;
  bullets: string[];
  reason?: string;
};

type EstadoOperativoResult = {
  estado: EstadoOperativo;
  color: EstadoOperativoColor;
  emoji: string;
  rango: string;
  explicacionEjecutiva: string;
};

type EscalaTier = EstadoOperativoResult & { min: number };

type Dimension = HealthFactor & { normalizedValue: number; explicacion: string };

type EquilibrioResponse = {
  healthScore: { score: number; classification: string; classificationColor: string; factors: HealthFactor[]; explain: { formula: string; steps: string[] } };
  dimensiones: Dimension[];
  estado: EstadoOperativoResult;
  escala: EscalaTier[];
  trend: ScoreTrendExplanation;
  meaning: string;
  impact: string;
  strengths: Insight[];
  weaknesses: Insight[];
  recommendations: SuggestedAction[];
  confidence: ConfidenceIndicators;
  calidad: {
    engineVersion: string;
    formulaSetVersion: string;
    insightsEngineVersion: string;
    fecha: string;
    origen: string;
    cacheActive: boolean;
    tiempoCalculoMs: number;
    registrosUtilizados: { semanasConsistencia: number; diasConsistencia: number };
    registrosDescartados: ExcludedPeriod[];
    advertencias: string[];
  };
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

const ESTADO_RING: Record<EstadoOperativoColor, string> = {
  green: "ring-success/25",
  blue: "ring-primary/25",
  yellow: "ring-warning/25",
  orange: "ring-orange-500/25",
  red: "ring-danger/25",
};
const ESTADO_TEXT: Record<EstadoOperativoColor, string> = {
  green: "text-success",
  blue: "text-primary",
  yellow: "text-warning",
  orange: "text-orange-600",
  red: "text-danger",
};
const ESTADO_BADGE_BG: Record<EstadoOperativoColor, string> = {
  green: "bg-success/[.13]",
  blue: "bg-primary-surface",
  yellow: "bg-warning/[.15]",
  orange: "bg-orange-500/[.13]",
  red: "bg-danger/[.13]",
};

const TREND_DIRECTION_STYLE: Record<ScoreTrendExplanation["direction"], { arrow: string; color: string; verb: string }> = {
  mejora: { arrow: "▲", color: "text-success", verb: "mejoró" },
  empeoro: { arrow: "▼", color: "text-danger", verb: "disminuyó" },
  estable: { arrow: "=", color: "text-disabled", verb: "se mantuvo estable" },
};

/** Franja fija de las 5 bandas — Bloque 12, "mostrar permanentemente" (no en un modal). */
function EscalaInterpretacion({ escala, currentEstado }: { escala: EscalaTier[]; currentEstado: EstadoOperativo }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-2">Escala de interpretación</p>
      <div className="space-y-1.5">
        {escala.map((tier) => (
          <div
            key={tier.estado}
            className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 ${
              tier.estado === currentEstado ? `${ESTADO_BADGE_BG[tier.color]} font-semibold` : ""
            }`}
          >
            <span className="text-secondary shrink-0 font-mono">{tier.rango}</span>
            <span className={`flex-1 ${ESTADO_TEXT[tier.color]}`}>{tier.emoji} {tier.estado}</span>
            <span className="text-disabled text-right">{tier.explicacionEjecutiva}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DimensionCard({ d }: { d: Dimension }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-title">{d.name}</p>
        <span className="text-xs font-bold text-primary">{d.points} pts</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-secondary mb-0.5">
        <span>Valor: <span className="font-mono text-main">{d.rawLabel}</span></span>
        <span>Peso: <span className="font-mono text-main">{d.weight}%</span></span>
      </div>
      <p className="text-[11px] text-disabled leading-relaxed">{d.explicacion}</p>
    </div>
  );
}

export function EquilibrioOperativoCard({ userId }: { userId: string }) {
  const [data, setData] = useState<EquilibrioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/equilibrio/${userId}`);
        if (!res.ok) throw new Error("failed");
        const json: EquilibrioResponse = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5 flex justify-center py-16">
        <Spinner className="w-6 h-6 text-primary" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5 text-sm text-disabled text-center py-8">
        No se pudo cargar Equilibrio Operativo. Intenta de nuevo.
      </div>
    );
  }

  const trendStyle = TREND_DIRECTION_STYLE[data.trend.direction];
  const explainFactors: ExplainFactor[] = data.dimensiones.map((d) => ({
    name: d.name,
    rawLabel: d.rawLabel,
    normalizedValue: d.normalizedValue,
    weight: d.weight,
    points: d.points,
  }));

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
          Equilibrio Operativo <HelpPopover title="Equilibrio Operativo" help={INDICATOR_HELP.equilibrioOperativo} />
        </h3>
        <Button variant="tertiary" size="sm" onClick={() => setExplainOpen(true)}>Ver detalle del cálculo</Button>
      </div>

      {/* Bloque 2 — score + estado + tendencia + variación, siempre juntos */}
      <div className="flex flex-wrap items-center gap-4">
        <div className={`w-20 h-20 rounded-full ring-4 ${ESTADO_RING[data.estado.color]} bg-background flex flex-col items-center justify-center shrink-0`}>
          <span className="text-2xl font-extrabold text-title leading-none">{Math.round(data.healthScore.score)}</span>
          <span className="text-[10px] text-disabled leading-none mt-0.5">/100</span>
        </div>
        <div>
          <p className={`text-lg font-bold ${ESTADO_TEXT[data.estado.color]}`}>{data.estado.emoji} {data.estado.estado}</p>
          {data.trend.available ? (
            <p className={`text-xs font-medium ${trendStyle.color}`}>
              {trendStyle.arrow} {trendStyle.verb} {data.trend.scoreDelta !== 0 && `${data.trend.scoreDelta > 0 ? "+" : ""}${data.trend.scoreDelta}pts`} vs. hace 30 días
            </p>
          ) : (
            <p className="text-xs text-disabled italic">{data.trend.reason ?? "Sin historial suficiente para mostrar tendencia."}</p>
          )}
        </div>
      </div>
      <ScoreZoneBar score={data.healthScore.score} />

      {/* Bloque 3 — ¿Qué significa este resultado? */}
      <div className="rounded-xl border border-border bg-background p-3.5">
        <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">¿Qué significa este resultado?</p>
        <p className="text-sm text-title leading-relaxed">{data.meaning}</p>
      </div>

      {/* Bloque 4 — Dimensiones del Equilibrio Operativo */}
      <div>
        <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-2">Dimensiones del Equilibrio Operativo</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.dimensiones.map((d) => (
            <DimensionCard key={d.name} d={d} />
          ))}
        </div>
      </div>

      {/* Bloque 5 — Fortalezas */}
      {data.strengths.length > 0 && (
        <div className="rounded-xl border border-success/25 bg-success/[.05] p-3.5">
          <p className="text-xs font-semibold text-success uppercase tracking-wider mb-2">¿Qué fortalece este resultado?</p>
          <ul className="space-y-1">
            {data.strengths.map((s) => (
              <li key={s.id} className="text-sm text-title flex items-start gap-2">
                <span className="text-success shrink-0">✔</span>
                <span>{s.hallazgo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bloque 6 — Aspectos a mejorar (con motivo) */}
      {data.weaknesses.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-warning uppercase tracking-wider mb-2">¿Qué reduce este resultado?</p>
          <div className="space-y-2">
            {data.weaknesses.map((w) => (
              <div key={w.id} className="rounded-xl border border-warning/30 bg-warning/[.05] p-3">
                <p className="text-sm text-title font-medium">⚠ {w.hallazgo}</p>
                <p className="text-xs text-secondary mt-1 leading-relaxed">{w.explicacion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bloque 7 — Impacto Operativo */}
      <div className="rounded-xl border border-primary/25 bg-primary-surface/40 p-3.5">
        <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">¿Qué impacto tiene este resultado?</p>
        <p className="text-sm font-semibold text-title">{data.impact}</p>
      </div>

      {/* Bloque 8 — Recomendaciones */}
      {data.recommendations.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-2">¿Qué puedo hacer para mejorar?</p>
          <div className="space-y-2">
            {data.recommendations.map((r, i) => (
              <ActionBlock key={i} accion={r} />
            ))}
          </div>
        </div>
      )}

      {/* Bloque 12 — Escala de interpretación, siempre visible */}
      <EscalaInterpretacion escala={data.escala} currentEstado={data.estado.estado} />

      {explainOpen && (
        <ExplainModal
          title="Equilibrio Operativo"
          formula={data.healthScore.explain.formula}
          steps={data.healthScore.explain.steps}
          factors={explainFactors}
          dataUsed={[
            `${data.calidad.registrosUtilizados.semanasConsistencia} semanas de historial de consistencia`,
            `${data.calidad.registrosUtilizados.diasConsistencia} días con registro analizados`,
            ...(data.calidad.registrosDescartados.length > 0
              ? [`${data.calidad.registrosDescartados.length} período(s) descartado(s): ${data.calidad.registrosDescartados.map((p) => `${p.period} (${p.reason})`).join("; ")}`]
              : []),
          ]}
          resultValue={Math.round(data.healthScore.score)}
          resultInterpretation={`${data.estado.emoji} ${data.estado.estado}`}
          engineVersion={data.calidad.engineVersion}
          formulaSetVersion={data.calidad.formulaSetVersion}
          lastUpdated={data.calidad.fecha}
          dataSource={data.calidad.origen}
          referenceUsed={SCORE_CLASSIFICATION_REFERENCE}
          confidence={data.confidence}
          onClose={() => setExplainOpen(false)}
        />
      )}

      {/* Bloque 14 — calidad del cálculo ampliada */}
      <div className="pt-3 border-t border-border">
        <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Calidad del cálculo</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-disabled">
          <span>Calculado: {formatDateTime(data.calidad.fecha)}</span>
          <span>Tiempo de procesamiento: {data.calidad.tiempoCalculoMs}ms</span>
          <span>Caché: {data.calidad.cacheActive ? "Activo" : "Recalculado ahora"}</span>
          <span>Motor: v{data.calidad.engineVersion} · Fórmulas v{data.calidad.formulaSetVersion} · Insights v{data.calidad.insightsEngineVersion}</span>
        </div>
        {data.calidad.advertencias.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {data.calidad.advertencias.map((a, i) => (
              <li key={i} className="text-[11px] text-warning">⚠ {a}</li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <ConfidenceBadges {...data.confidence} compact />
        </div>
      </div>
    </div>
  );
}
