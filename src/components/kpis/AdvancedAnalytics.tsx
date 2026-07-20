"use client";

import { useState, useEffect } from "react";
import type {
  AnalyticsBundle,
  TrendResult,
  ConsistencyResult,
  AnomalyResult,
  Prediction,
  HealthScoreResult,
  DataQualityResult,
  EngineAlert,
  KpiTrends,
} from "./types";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ── Explicabilidad genérica — "Ver cálculo" (§7) ─────────────────────────────

export function ExplainModal({
  title,
  formula,
  steps,
  engineVersion,
  onClose,
}: {
  title: string;
  formula: string;
  steps: string[];
  engineVersion: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">Ver cálculo — {title}</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-secondary mb-3">
          Fórmula: <code className="text-title bg-background px-1.5 py-0.5 rounded">{formula}</code>
        </p>
        <ol className="space-y-1.5 mb-3 list-decimal list-inside">
          {steps.map((s, i) => (
            <li key={i} className="text-sm text-title">{s}</li>
          ))}
        </ol>
        <p className="text-[11px] text-disabled pt-3 border-t border-border">Motor: Analytics Engine v{engineVersion}</p>
      </div>
    </div>
  );
}

// ── Score de Salud Laboral (§3) ────────────────────────────────────────────────

const CLASS_TEXT: Record<string, string> = { Excelente: "text-success", Bueno: "text-success", Riesgo: "text-warning", Crítico: "text-danger" };
const CLASS_RING: Record<string, string> = { Excelente: "ring-success/25", Bueno: "ring-success/25", Riesgo: "ring-warning/25", Crítico: "ring-danger/25" };
const CLASS_EMOJI: Record<string, string> = { Excelente: "🟢", Bueno: "🟢", Riesgo: "🟡", Crítico: "🔴" };

export function HealthScoreCard({ result, onExplain }: { result: HealthScoreResult; onExplain: () => void }) {
  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Score de Salud Laboral</h3>
        <button onClick={onExplain} className="text-xs font-medium text-primary hover:text-primary-hover">Ver cálculo</button>
      </div>
      <div className="flex items-center gap-4 mb-4">
        <div className={`w-20 h-20 rounded-full ring-4 ${CLASS_RING[result.classification]} bg-background flex flex-col items-center justify-center shrink-0`}>
          <span className="text-2xl font-extrabold text-title leading-none">{Math.round(result.score)}</span>
          <span className="text-[10px] text-disabled leading-none mt-0.5">/100</span>
        </div>
        <p className={`text-lg font-bold ${CLASS_TEXT[result.classification]}`}>{CLASS_EMOJI[result.classification]} {result.classification}</p>
      </div>
      <div className="space-y-1.5">
        {result.factors.map((f) => (
          <div key={f.name} className="flex items-center justify-between text-xs">
            <span className="text-secondary">{f.name} <span className="text-disabled">({f.rawLabel})</span></span>
            <span className="font-semibold text-main">{f.points} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Motor de alertas (§1) ──────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<string, string> = { red: "Acción inmediata", orange: "Revisar esta semana", yellow: "Monitorear", green: "Informativo" };
const SEVERITY_EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢" };
const SEVERITY_TEXT: Record<string, string> = { red: "text-danger", orange: "text-orange-500", yellow: "text-warning", green: "text-success" };
const SEVERITY_BG: Record<string, string> = { red: "bg-danger/[.08]", orange: "bg-orange-500/[.08]", yellow: "bg-warning/[.1]", green: "bg-success/[.08]" };

export function EngineAlertsCard({ alerts }: { alerts: EngineAlert[] }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Alertas automáticas</h3>
        {alerts.length > 0 && <span className="text-xs font-bold text-danger bg-danger/[.15] px-2 py-0.5 rounded-full">{alerts.length}</span>}
      </div>
      {alerts.length === 0 ? (
        <p className="text-sm text-success flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success shrink-0" /> Sin alertas activas
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`rounded-xl p-3 ${SEVERITY_BG[a.severity]}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase tracking-wider ${SEVERITY_TEXT[a.severity]}`}>
                  {SEVERITY_EMOJI[a.severity]} {SEVERITY_LABEL[a.severity]}
                </span>
                <span className="text-[10px] text-disabled ml-auto">{new Date(a.detectedAt).toLocaleDateString("es-CL")}</span>
              </div>
              <p className="text-sm text-title mb-1">{a.message}</p>
              <p className="text-xs text-secondary">→ {a.suggestedAction}</p>
              <p className="text-[10px] text-disabled mt-1 font-mono">{a.rule}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tendencias (§2) ────────────────────────────────────────────────────────────

function TrendBadge({ label, trend, unit = "%" }: { label: string; trend: TrendResult; unit?: string }) {
  if (!trend.available) {
    return (
      <div className="flex items-center justify-between text-sm py-1.5">
        <span className="text-secondary">{label}</span>
        <span className="text-disabled text-xs italic">{trend.reason}</span>
      </div>
    );
  }
  const arrow = trend.direction === "mejora" ? "▲" : trend.direction === "empeoro" ? "▼" : "=";
  const color = trend.direction === "mejora" ? "text-success" : trend.direction === "empeoro" ? "text-danger" : "text-disabled";
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="text-secondary">{label}</span>
      <span className={`font-semibold ${color}`}>
        {arrow} {Math.abs(trend.absoluteDiff)}{unit} ({trend.current}{unit} vs {trend.compared}{unit})
      </span>
    </div>
  );
}

export function TrendsCard({ trends }: { trends: KpiTrends }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Tendencias</h3>
      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mt-2 mb-0.5">Cumplimiento</p>
      <div className="divide-y divide-border">
        <TrendBadge label="vs. semana anterior" trend={trends.cumplimiento.semanaAnterior} />
        <TrendBadge label="vs. mes anterior" trend={trends.cumplimiento.mesAnterior} />
        <TrendBadge label="vs. promedio últimos 6 meses" trend={trends.cumplimiento.promedio6Meses} />
      </div>
      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mt-3 mb-0.5">Carga laboral</p>
      <div className="divide-y divide-border">
        <TrendBadge label="vs. semana anterior" trend={trends.carga.semanaAnterior} />
        <TrendBadge label="vs. mes anterior" trend={trends.carga.mesAnterior} />
        <TrendBadge label="vs. promedio últimos 6 meses" trend={trends.carga.promedio6Meses} />
      </div>
    </div>
  );
}

// ── Consistencia (§4) ──────────────────────────────────────────────────────────

const CONSISTENCY_COLOR: Record<string, string> = { "muy-consistente": "text-success", "consistente": "text-success", "variable": "text-warning", "muy-variable": "text-danger" };

export function ConsistencyCard({ result }: { result: ConsistencyResult }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Consistencia</h3>
      {!result.available ? (
        <p className="text-sm text-disabled italic">{result.reason}</p>
      ) : (
        <>
          <p className={`text-xl font-bold ${CONSISTENCY_COLOR[result.level]}`}>{result.label}</p>
          <p className="text-xs text-secondary mt-1">Variación (CV): {result.coefficientOfVariation}% · {result.weeksAnalyzed} semanas analizadas</p>
        </>
      )}
    </div>
  );
}

// ── Anomalías (§5) ──────────────────────────────────────────────────────────────

export function AnomaliesCard({ result }: { result: AnomalyResult }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Anomalías</h3>
      {!result.available ? (
        <p className="text-sm text-disabled italic">{result.reason}</p>
      ) : result.anomalies.length === 0 ? (
        <p className="text-sm text-success">Sin anomalías detectadas este período</p>
      ) : (
        <ul className="space-y-2">
          {result.anomalies.map((a, i) => (
            <li key={i} className={`text-sm ${a.severity === "orange" ? "text-orange-500" : "text-warning"}`}>
              {a.severity === "orange" ? "🟠" : "🟡"} {a.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Predicción simple (§6) ──────────────────────────────────────────────────────

const CONFIDENCE_LABEL: Record<string, string> = { alta: "Alta confianza", media: "Media confianza", baja: "Baja confianza" };
const CONFIDENCE_COLOR: Record<string, string> = { alta: "text-success", media: "text-warning", baja: "text-disabled" };

export function PredictionCard({ result }: { result: Prediction }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Predicción</h3>
        {result.available && (
          <span className={`text-[11px] font-semibold ${CONFIDENCE_COLOR[result.confidence]}`}>{CONFIDENCE_LABEL[result.confidence]}</span>
        )}
      </div>
      {!result.available ? (
        <p className="text-sm text-disabled italic">{result.reason}</p>
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-secondary">Carga próxima semana</span>
            <span className="font-semibold text-main">{result.cargaProximaSemanaHoras}h</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-secondary">Cumplimiento estimado al cierre</span>
            <span className="font-semibold text-main">{result.cumplimientoEstimadoCierreMes}%</span>
          </div>
          {result.horasParaRangoOptimo > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-secondary">Horas para alcanzar rango óptimo</span>
              <span className="font-semibold text-main">{result.horasParaRangoOptimo}h</span>
            </div>
          )}
          <p className="text-[10px] text-disabled pt-1.5 border-t border-border mt-1.5">
            Basado en {result.weeksOfData} {result.weeksOfData === 1 ? "semana" : "semanas"} de datos · proyección máxima {result.maxProjectionDays} días
          </p>
        </div>
      )}
    </div>
  );
}

// ── Calidad de los datos (§15) ──────────────────────────────────────────────────

export function DataQualityCard({ result }: { result: DataQualityResult }) {
  const color = result.pct >= 90 ? "text-success" : result.pct >= 70 ? "text-warning" : "text-danger";
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Calidad de los datos</h3>
      <p className={`text-2xl font-bold ${color}`}>{result.pct}%</p>
      {result.issues.length === 0 ? (
        <p className="text-xs text-success mt-1">Sin problemas de calidad detectados</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {result.issues.map((issue) => (
            <li key={issue.key} className="text-xs text-secondary">⚠ {issue.label}: <strong className="text-main">{issue.count}</strong></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Panel completo (self-fetching) ──────────────────────────────────────────────

export function AdvancedAnalyticsPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<AnalyticsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/${userId}`);
        if (!res.ok) throw new Error("failed");
        const json: AnalyticsBundle = await res.json();
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
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-disabled text-center py-8">No se pudo cargar Analytics avanzado. Intenta de nuevo.</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-disabled">
        Analytics Engine v{data.engineVersion} · Última actualización: {formatDateTime(data.lastUpdated)}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HealthScoreCard result={data.healthScore} onExplain={() => setExplainOpen(true)} />
        <EngineAlertsCard alerts={data.alerts} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ConsistencyCard result={data.consistency} />
        <AnomaliesCard result={data.anomalies} />
        <PredictionCard result={data.prediction} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrendsCard trends={data.trends} />
        <DataQualityCard result={data.dataQuality} />
      </div>

      {explainOpen && (
        <ExplainModal
          title="Score de Salud Laboral"
          formula={data.healthScore.explain.formula}
          steps={data.healthScore.explain.steps}
          engineVersion={data.engineVersion}
          onClose={() => setExplainOpen(false)}
        />
      )}
    </div>
  );
}
