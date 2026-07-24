"use client";

import { useState, useEffect } from "react";
import type { SmartBenchmarkResult, MetricBenchmark, PersonalEvolution } from "./types";
import { InfoTooltip, ConfidenceBadges } from "./AdvancedAnalytics";
import { CONFIDENCE_TOOLTIPS, MIN_PEER_SAMPLE, type ConfidenceIndicators } from "@/lib/analyticsExplain";
import { Button } from "@/components/ui/Button";

// ── Metadatos por métrica (unidad, dirección "mejor") ────────────────────────

type MetricKey = "performance" | "operationalRisk" | "cumplimiento" | "cargaLaboral" | "capacidadFutura";

const METRIC_META: Record<MetricKey, { label: string; unit: string; direction: "higher" | "lower" | "closest-100" }> = {
  performance: { label: "Performance Score", unit: "pts", direction: "higher" },
  operationalRisk: { label: "Índice de Riesgo Operativo", unit: "pts", direction: "lower" },
  cumplimiento: { label: "Cumplimiento", unit: "%", direction: "higher" },
  cargaLaboral: { label: "Carga laboral", unit: "%", direction: "closest-100" },
  capacidadFutura: { label: "Capacidad futura", unit: "%", direction: "higher" },
};

/** Verde si `diff` va en la dirección deseada, rojo si va en contra, gris si es ~0 o no aplica. */
function diffColor(diff: number, direction: "higher" | "lower" | "closest-100"): string {
  if (Math.abs(diff) < 0.5 || direction === "closest-100") return "text-disabled";
  const good = direction === "higher" ? diff > 0 : diff < 0;
  return good ? "text-success" : "text-danger";
}

function formatDiff(diff: number, unit: string): string {
  return `${diff > 0 ? "+" : ""}${diff}${unit === "pts" ? " pts" : unit}`;
}

// ── Bloque por métrica, según el modo del motor de decisión ──────────────────

function CargoMetricBlock({ metricKey, m }: { metricKey: MetricKey; m: Extract<MetricBenchmark, { mode: "cargo" }> }) {
  const meta = METRIC_META[metricKey];
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <p className="text-xs font-semibold text-title mb-2">{meta.label}</p>
      <p className="text-2xl font-extrabold text-title leading-none mb-2">
        {m.value}
        <span className="text-xs font-normal text-disabled ml-1">{meta.unit}</span>
      </p>
      <div className="text-[11px] text-secondary space-y-0.5">
        <div className="flex items-center justify-between">
          <span>Promedio del cargo</span>
          <span className="font-semibold text-main">{m.peerAverage}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Percentil</span>
          <span className="font-semibold text-main">{m.percentile}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Mejor del cargo</span>
          <span className="font-semibold text-main">{m.best}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Diferencia vs. promedio</span>
          <span className={`font-semibold ${diffColor(m.diffFromAverage, meta.direction)}`}>{formatDiff(m.diffFromAverage, meta.unit)}</span>
        </div>
      </div>
    </div>
  );
}

function CargoLimitadoMetricBlock({ metricKey, m }: { metricKey: MetricKey; m: Extract<MetricBenchmark, { mode: "cargo-limitado" }> }) {
  const meta = METRIC_META[metricKey];
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <p className="text-xs font-semibold text-title mb-2">{meta.label}</p>
      <p className="text-2xl font-extrabold text-title leading-none mb-2">
        {m.value}
        <span className="text-xs font-normal text-disabled ml-1">{meta.unit}</span>
      </p>
      <div className="text-[11px] text-secondary space-y-0.5">
        <div className="flex items-center justify-between">
          <span>Promedio del cargo (n=2)</span>
          <span className="font-semibold text-main">{m.peerAverage}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Diferencia vs. promedio</span>
          <span className={`font-semibold ${diffColor(m.diffFromAverage, meta.direction)}`}>{formatDiff(m.diffFromAverage, meta.unit)}</span>
        </div>
      </div>
      <p className="text-[10px] text-disabled italic mt-1.5">Muestra insuficiente para percentiles o rankings.</p>
    </div>
  );
}

function PersonalMetricRow({ label, value, diff, unit, direction }: { label: string; value: number | null; diff: number | null; unit: string; direction: "higher" | "lower" | "closest-100" }) {
  if (value === null) {
    return (
      <div className="flex items-center justify-between text-[11px] py-0.5">
        <span className="text-disabled">{label}</span>
        <span className="text-disabled italic">Sin dato</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between text-[11px] py-0.5">
      <span className="text-disabled">{label}</span>
      <span className="text-main">
        <span className="font-semibold">{value}{unit}</span>
        {diff !== null && <span className={`ml-1.5 font-semibold ${diffColor(diff, direction)}`}>{formatDiff(diff, unit)}</span>}
      </span>
    </div>
  );
}

function PersonalMetricBlock({ metricKey, m }: { metricKey: MetricKey; m: Extract<MetricBenchmark, { mode: "personal" }> }) {
  const meta = METRIC_META[metricKey];
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <p className="text-xs font-semibold text-title mb-2">{meta.label}</p>
      <p className="text-2xl font-extrabold text-title leading-none mb-2">
        {m.value}
        <span className="text-xs font-normal text-disabled ml-1">{meta.unit}</span>
      </p>
      {m.target !== null && (
        <div className="flex items-center justify-between text-[11px] py-0.5 mb-1 pb-1.5 border-b border-border">
          <span className="text-secondary font-medium">Objetivo del cargo</span>
          <span className="text-main">
            <span className="font-semibold">{m.target}{meta.unit}</span>
            {m.targetGap !== null && <span className={`ml-1.5 font-semibold ${diffColor(m.targetGap, meta.direction)}`}>Brecha {formatDiff(m.targetGap, meta.unit)}</span>}
          </span>
        </div>
      )}
      <PersonalMetricRow label="Mejor histórico" value={m.bestEver} diff={m.bestEverDiff} unit={meta.unit} direction={meta.direction} />
      <PersonalMetricRow label="Promedio últimos 90 días" value={m.avgLast90Days} diff={m.avgLast90DaysDiff} unit={meta.unit} direction={meta.direction} />
      <PersonalMetricRow label="Semana anterior" value={m.semanaAnterior} diff={m.semanaAnteriorDiff} unit={meta.unit} direction={meta.direction} />
      <PersonalMetricRow label="Mes anterior" value={m.mesAnterior} diff={m.mesAnteriorDiff} unit={meta.unit} direction={meta.direction} />
      {m.note && <p className="text-[10px] text-disabled italic mt-1.5 pt-1.5 border-t border-border">{m.note}</p>}
    </div>
  );
}

function MetricBlock({ metricKey, m }: { metricKey: MetricKey; m: MetricBenchmark }) {
  if (m.mode === "cargo") return <CargoMetricBlock metricKey={metricKey} m={m} />;
  if (m.mode === "cargo-limitado") return <CargoLimitadoMetricBlock metricKey={metricKey} m={m} />;
  return <PersonalMetricBlock metricKey={metricKey} m={m} />;
}

// ── Mensaje de cabecera — NUNCA "Sin compañeros del mismo rol" ───────────────

const MODE_HEADLINE: Record<SmartBenchmarkResult["mode"], string> = {
  cargo: "Comparando contra el promedio del cargo",
  "cargo-limitado": "Comparando contra el promedio del cargo (muestra limitada)",
  personal: "Comparando contra tu propio historial",
};

const MODE_BADGE: Record<SmartBenchmarkResult["mode"], string> = {
  cargo: "bg-success/[.1] text-success",
  "cargo-limitado": "bg-warning/[.12] text-warning",
  personal: "bg-primary-surface text-primary",
};

// ── "¿Cómo se obtuvo este resultado?" (§Sprint 6.5 S6.5-E) ──────────────────

const MODE_LABEL: Record<SmartBenchmarkResult["mode"], string> = {
  cargo: "Cargo",
  "cargo-limitado": "Cargo (muestra limitada)",
  personal: "Historial personal",
};

function BenchmarkExplainModal({
  result,
  evolution,
  confidence,
  lastUpdated,
  onClose,
}: {
  result: SmartBenchmarkResult;
  evolution: PersonalEvolution;
  confidence: ConfidenceIndicators;
  lastUpdated: string;
  onClose: () => void;
}) {
  const isPersonal = result.mode === "personal";
  const modeLabel = MODE_LABEL[result.mode];

  // §S6.5-D — nunca solo "Historial personal": se listan las señales
  // concretas que respaldan el cálculo, nunca inventadas (mismos campos que
  // ya calcula computePersonalEvolution/computeSmartBenchmark).
  const dataUsed: string[] = isPersonal
    ? evolution.available
      ? [
          `${evolution.observations} ${evolution.observations === 1 ? "observación histórica analizada" : "observaciones históricas analizadas"}`,
          `${evolution.spanWeeks} ${evolution.spanWeeks === 1 ? "semana" : "semanas"} de historial personal considerado`,
        ]
      : [result.explain.dataAvailable]
    : [`${result.explain.peerCount + 1} colaboradores del cargo con datos del mes en curso`, `Período: ${result.explain.periodAnalyzed}`];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">¿Cómo se obtuvo este resultado?</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-secondary flex items-center gap-1">Referencia utilizada <InfoTooltip text={CONFIDENCE_TOOLTIPS.referenciaUtilizada} /></span>
            <span className="font-semibold text-title">{modeLabel}</span>
          </div>
          <div>
            <p className="text-secondary text-xs mb-0.5">Motivo</p>
            <p className="text-title">{result.explain.reason}</p>
          </div>

          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Datos utilizados</p>
            <ul className="space-y-1">
              {dataUsed.map((d, i) => (
                <li key={i} className="text-xs text-title flex items-start gap-1.5">
                  <span className="text-success shrink-0">✓</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-secondary">Grupo comparable</span>
              <span className="font-semibold text-title">{isPersonal ? "No aplica" : `${result.explain.peerCount} colaboradores`}</span>
            </div>
            {isPersonal && (
              <p className="text-[11px] text-disabled mt-1">
                Se requiere una muestra mínima de {MIN_PEER_SAMPLE} colaboradores con el mismo cargo para realizar comparaciones entre pares. Por este motivo el sistema utiliza su evolución histórica como referencia — cuando exista una muestra suficiente, la referencia cambiará automáticamente.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-secondary">Período utilizado</span>
            <span className="font-semibold text-title">{result.explain.periodAnalyzed}</span>
          </div>

          {result.roleTarget && (
            <div className="pt-2 border-t border-border">
              <p className="text-secondary text-xs mb-1">Objetivo del cargo configurado</p>
              {result.roleTarget.performance !== null && <p className="text-title text-xs">Performance esperado: {result.roleTarget.performance} pts</p>}
              {result.roleTarget.riesgoMax !== null && <p className="text-title text-xs">Riesgo Operativo máximo esperado: {result.roleTarget.riesgoMax} pts</p>}
              {result.roleTarget.cumplimiento !== null && <p className="text-title text-xs">Cumplimiento esperado: {result.roleTarget.cumplimiento}%</p>}
            </div>
          )}
        </div>

        <div className="pt-3 mt-3 border-t border-border">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Confianza del cálculo</p>
          <ConfidenceBadges {...confidence} />
        </div>

        <div className="pt-3 mt-3 border-t border-border">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Resumen de auditoría</p>
          <div className="space-y-1 text-[11px] text-secondary">
            <div className="flex items-center justify-between">
              <span>Fecha del cálculo</span>
              <span className="text-title font-medium">{new Date(lastUpdated).toLocaleString("es-CL")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Versión del motor</span>
              <span className="text-title font-medium">Analytics Engine v{result.engineVersion}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Referencia utilizada</span>
              <span className="text-title font-medium">{modeLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Calidad del dato</span>
              <span className="text-title font-medium">{confidence.dataQualityPct}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Confiabilidad</span>
              <span className="text-title font-medium">{confidence.reliabilityPct}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Evolución Personal (§Sprint 7) — siempre visible ──────────────────────────

function PersonalEvolutionCard({ evolution }: { evolution: PersonalEvolution }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Evolución Personal</h3>
      {!evolution.available ? (
        <p className="text-sm text-disabled italic">{evolution.reason}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-disabled uppercase tracking-wider">Performance</p>
              <p className="text-lg font-bold text-title">{evolution.current}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-disabled uppercase tracking-wider">Mejor histórico</p>
              <p className="text-lg font-bold text-success">{evolution.bestEver}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-disabled uppercase tracking-wider">Promedio histórico</p>
              <p className="text-lg font-bold text-title">{evolution.average}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-disabled uppercase tracking-wider">Peor histórico</p>
              <p className="text-lg font-bold text-danger">{evolution.worstEver}</p>
            </div>
          </div>
          {evolution.trend.available ? (
            <p className="text-xs text-secondary">
              Tendencia vs. {evolution.trend.basis}:{" "}
              <strong className={evolution.trend.direction === "mejora" ? "text-success" : evolution.trend.direction === "empeoro" ? "text-danger" : "text-disabled"}>
                {evolution.trend.direction === "mejora" ? "▲" : evolution.trend.direction === "empeoro" ? "▼" : "="} {formatDiff(evolution.trend.diff, " pts")}
              </strong>
            </p>
          ) : (
            <p className="text-xs text-disabled italic">Historial insuficiente para tendencias (menos de 4 semanas de datos).</p>
          )}
          <p className="text-[10px] text-disabled mt-2">{evolution.observations} observaciones · {evolution.spanWeeks} semanas de historial</p>
        </>
      )}
    </div>
  );
}

// ── Panel completo (self-fetching) ──────────────────────────────────────────

const METRIC_ORDER: MetricKey[] = ["performance", "operationalRisk", "cumplimiento", "cargaLaboral", "capacidadFutura"];

export function SmartBenchmarkPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<{ benchmark: SmartBenchmarkResult; evolution: PersonalEvolution; confidence: ConfidenceIndicators; lastUpdated: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/benchmarks/${userId}`);
        if (!res.ok) throw new Error("failed");
        if (!cancelled) setData(await res.json());
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
      <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5 flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-disabled text-center py-6">No se pudo cargar la referencia utilizada.</div>;
  }

  const { benchmark, evolution, confidence, lastUpdated } = data;

  return (
    <div className="space-y-5">
      <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
              Referencia utilizada <InfoTooltip text={CONFIDENCE_TOOLTIPS.referenciaUtilizada} />
            </h3>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${MODE_BADGE[benchmark.mode]}`}>{MODE_HEADLINE[benchmark.mode]}</span>
          </div>
          <Button variant="tertiary" size="sm" onClick={() => setExplainOpen(true)}>
            ¿Cómo se obtuvo este resultado?
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {METRIC_ORDER.map((key) => (
            <MetricBlock key={key} metricKey={key} m={benchmark[key]} />
          ))}
        </div>
        <div className="pt-3 mt-3 border-t border-border">
          <ConfidenceBadges {...confidence} compact />
        </div>
      </div>

      <PersonalEvolutionCard evolution={evolution} />

      {explainOpen && (
        <BenchmarkExplainModal result={benchmark} evolution={evolution} confidence={confidence} lastUpdated={lastUpdated} onClose={() => setExplainOpen(false)} />
      )}
    </div>
  );
}
