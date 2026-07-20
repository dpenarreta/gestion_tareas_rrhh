"use client";

import { useState, useEffect } from "react";
import { MaturityStars } from "./AdvancedAnalytics";

// ── Tipos — reflejan src/lib/insightsEngine.ts (Sprint 6 — Decision Intelligence Engine) ──

type Confidence = { stars: 1 | 2 | 3 | 4 | 5; label: string };
type EvidenceItem = { label: string; before: string; after: string };
type ActionImpact = { metric: string; delta: number; unit: string };
type SuggestedAction = { what: string; who: string; howMuch: string; when: string; impact: ActionImpact[] | null; impactNote: string };
type Insight = {
  id: string;
  tone: "risk" | "positive" | "neutral";
  hallazgo: string;
  explicacion: string;
  evidencia: EvidenceItem[];
  accion: SuggestedAction | null;
  confidence: Confidence;
};
type IndicatorRelation = { id: string; statement: string; confidence: "alta" | "media" | "baja"; evidencia: EvidenceItem[] };
type PersonalBenchmark = {
  current: number;
  average: number;
  bestEver: { score: number; period: string } | null;
  bestWeek: { score: number; weekOf: string } | null;
  last4Weeks: number | null;
  last3Months: number | null;
  percentile: number;
  narrative: string;
  observations: number;
  confidence: Confidence;
};
type Reevaluation = { rule: string; message: string; status: "mejorada" | "valida" | "prioritaria" | "sin-datos"; referenceDaysAgo: number };

type InsightsResponse = {
  insights: Insight[];
  prioritized: { top: Insight[]; additional: Insight[] };
  relations: IndicatorRelation[];
  personalBenchmark: PersonalBenchmark;
  reevaluations: Reevaluation[];
  engineVersion: string;
  insightsEngineVersion: string;
  lastUpdated: string;
};

const TONE_STYLE: Record<Insight["tone"], { border: string; bg: string; label: string; emoji: string }> = {
  risk: { border: "border-warning/30", bg: "bg-warning/[.05]", label: "Atención", emoji: "🟠" },
  positive: { border: "border-success/30", bg: "bg-success/[.05]", label: "Positivo", emoji: "🟢" },
  neutral: { border: "border-border", bg: "bg-background", label: "Informativo", emoji: "ℹ️" },
};

const RELATION_CONFIDENCE_STYLE: Record<IndicatorRelation["confidence"], string> = {
  alta: "text-success bg-success/[.1]",
  media: "text-warning bg-warning/[.12]",
  baja: "text-disabled bg-surface2",
};

const REEVAL_STYLE: Record<Reevaluation["status"], { text: string; emoji: string }> = {
  mejorada: { text: "text-success", emoji: "✅" },
  valida: { text: "text-warning", emoji: "🟡" },
  prioritaria: { text: "text-danger", emoji: "🔴" },
  "sin-datos": { text: "text-disabled", emoji: "⏳" },
};

function EvidenceTable({ evidencia }: { evidencia: EvidenceItem[] }) {
  if (evidencia.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-background p-2.5 space-y-1">
      {evidencia.map((e, i) => (
        <div key={i} className="flex items-center justify-between text-[11px] gap-2">
          <span className="text-disabled shrink-0">{e.label}</span>
          <span className="font-mono text-main text-right">
            {e.before !== "—" ? <>{e.before} → </> : null}
            <strong>{e.after}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

function ActionBlock({ accion }: { accion: SuggestedAction }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary-surface/40 p-2.5 space-y-1">
      <p className="text-xs text-title"><strong>Qué:</strong> {accion.what}</p>
      <p className="text-xs text-title"><strong>A quién:</strong> {accion.who}</p>
      <p className="text-xs text-title"><strong>Cuánto:</strong> {accion.howMuch}</p>
      <p className="text-xs text-title"><strong>Cuándo:</strong> {accion.when}</p>
      <div className="pt-1 mt-1 border-t border-primary/15">
        {accion.impact && accion.impact.length > 0 ? (
          <p className="text-[11px] text-secondary">
            Impacto esperado:{" "}
            {accion.impact.map((imp, i) => (
              <span key={i}>
                {i > 0 && " · "}
                <strong className={imp.delta < 0 || (imp.metric === "Performance Score" && imp.delta > 0) ? "text-success" : "text-danger"}>
                  {imp.delta > 0 ? "+" : ""}
                  {imp.delta} {imp.unit} {imp.metric}
                </strong>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-[11px] text-disabled italic">{accion.impactNote}</p>
        )}
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const style = TONE_STYLE[insight.tone];
  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-3.5 space-y-2.5`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-secondary">
          {style.emoji} {style.label}
        </p>
        <MaturityStars level={insight.confidence.stars} title={`Confianza del insight: ${insight.confidence.label}`} />
      </div>
      <p className="text-sm font-semibold text-title">{insight.hallazgo}</p>
      <p className="text-xs text-secondary leading-relaxed">{insight.explicacion}</p>
      <EvidenceTable evidencia={insight.evidencia} />
      {insight.accion && <ActionBlock accion={insight.accion} />}
    </div>
  );
}

function RelationCard({ relation }: { relation: IndicatorRelation }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-title flex-1">{relation.statement}</p>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${RELATION_CONFIDENCE_STYLE[relation.confidence]}`}>
          Confianza {relation.confidence}
        </span>
      </div>
      <EvidenceTable evidencia={relation.evidencia} />
    </div>
  );
}

function BenchmarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[10px] text-disabled uppercase tracking-wider">{label}</p>
      <p className="text-base font-bold text-title">{value}</p>
    </div>
  );
}

function PersonalBenchmarkSection({ benchmark }: { benchmark: PersonalBenchmark }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Benchmark personal — solo contra su propio historial</h3>
        <MaturityStars level={benchmark.confidence.stars} title={`Confianza: ${benchmark.confidence.label}`} />
      </div>
      {benchmark.observations === 0 ? (
        <p className="text-sm text-disabled italic">{benchmark.narrative}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <BenchmarkStat label="Performance actual" value={`${benchmark.current}`} />
            <BenchmarkStat label="Promedio histórico" value={`${benchmark.average}`} />
            <BenchmarkStat label="Mejor histórico" value={benchmark.bestEver ? `${benchmark.bestEver.score}` : "—"} />
            <BenchmarkStat label="Percentil personal" value={`${benchmark.percentile}%`} />
            <BenchmarkStat label="Últimas 4 semanas" value={benchmark.last4Weeks !== null ? `${benchmark.last4Weeks}` : "—"} />
            <BenchmarkStat label="Últimos 3 meses" value={benchmark.last3Months !== null ? `${benchmark.last3Months}` : "—"} />
            <BenchmarkStat label="Mejor semana" value={benchmark.bestWeek ? `${benchmark.bestWeek.score}` : "—"} />
            <BenchmarkStat label="Observaciones" value={`${benchmark.observations}`} />
          </div>
          <p className="text-sm text-title font-medium">{benchmark.narrative}</p>
        </>
      )}
    </div>
  );
}

function ReevaluationSection({ reevaluations }: { reevaluations: Reevaluation[] }) {
  if (reevaluations.length === 0) return null;
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Reevaluación de recomendaciones anteriores</h3>
      <div className="space-y-1.5">
        {reevaluations.map((r, i) => {
          const style = REEVAL_STYLE[r.status];
          return (
            <p key={i} className="text-xs flex items-start gap-1.5">
              <span>{style.emoji}</span>
              <span className={style.text}>{r.message}</span>
              <span className="text-disabled ml-auto shrink-0">hace {r.referenceDaysAgo} {r.referenceDaysAgo === 1 ? "día" : "días"}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

function PrioritizedSection({ prioritized }: { prioritized: { top: Insight[]; additional: Insight[] } }) {
  const [showAdditional, setShowAdditional] = useState(false);
  if (prioritized.top.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-2">Recomendaciones prioritarias</p>
      <div className="space-y-3">
        {prioritized.top.map((i) => (
          <InsightCard key={i.id} insight={i} />
        ))}
      </div>
      {prioritized.additional.length > 0 && (
        <div className="mt-3">
          {!showAdditional ? (
            <button onClick={() => setShowAdditional(true)} className="text-xs font-medium text-primary hover:text-primary-hover">
              Ver recomendaciones adicionales ({prioritized.additional.length})
            </button>
          ) : (
            <div className="space-y-3">
              {prioritized.additional.map((i) => (
                <InsightCard key={i.id} insight={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Panel de Decision Intelligence (Sprint 6) — se auto-alimenta de
 * /api/analytics/insights/[userId]. Responde qué ocurrió (hallazgos con
 * evidencia), por qué (explicaciones + relaciones entre indicadores), qué
 * puede ocurrir (impacto esperado de cada acción) y qué acción tendría mayor
 * impacto (priorización). Todo el cálculo viene del motor — este componente
 * solo renderiza.
 */
export function InsightsPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/insights/${userId}`);
        if (!res.ok) throw new Error("failed");
        const json: InsightsResponse = await res.json();
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
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-disabled text-center py-8">No se pudo cargar el Motor de Insights.</div>;
  }

  const prioritizedIds = new Set([...data.prioritized.top, ...data.prioritized.additional].map((i) => i.id));
  const otherInsights = data.insights.filter((i) => !prioritizedIds.has(i.id));

  return (
    <div className="space-y-5">
      <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Motor de Insights</h3>
        {data.insights.length === 0 ? (
          <p className="text-sm text-disabled py-4 text-center">Sin hallazgos relevantes este período.</p>
        ) : (
          <>
            <PrioritizedSection prioritized={data.prioritized} />
            {otherInsights.length > 0 && (
              <div className="space-y-3 pt-1">
                {data.prioritized.top.length > 0 && <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider">Otros hallazgos</p>}
                {otherInsights.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {data.relations.length > 0 && (
        <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
          <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-1">Relaciones entre indicadores</h3>
          <p className="text-[11px] text-disabled mb-3">Reglas determinísticas — nunca implican causalidad absoluta, solo relación observada.</p>
          <div className="space-y-2.5">
            {data.relations.map((r) => (
              <RelationCard key={r.id} relation={r} />
            ))}
          </div>
        </div>
      )}

      <PersonalBenchmarkSection benchmark={data.personalBenchmark} />

      <ReevaluationSection reevaluations={data.reevaluations} />

      <p className="text-[10px] text-disabled">
        Motor de Insights v{data.insightsEngineVersion} sobre Analytics Engine v{data.engineVersion} · calculado {new Date(data.lastUpdated).toLocaleString("es-CL")}
      </p>
    </div>
  );
}
