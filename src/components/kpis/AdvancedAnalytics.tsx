"use client";

import { useState, useEffect } from "react";
import type {
  AnalyticsBundle,
  TrendResult,
  ConsistencyResult,
  AnomalyResult,
  Prediction,
  HealthScoreResult,
  PerformanceScoreResult,
  DataQualityResult,
  EngineAlert,
  KpiTrends,
  BenchmarkResult,
  ScoreTrendHistory,
} from "./types";
import type { ResolvedAlert } from "@/lib/analytics";
import { isFeatureEnabled } from "@/lib/featureFlags";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ── Navegación interna (§S2-C) ────────────────────────────────────────────────
// Barra pegajosa de índice — cada sección ancla vía id; se usa `<a href="#id">`
// en vez de scroll manual en JS para mantenerlo simple y accesible (funciona
// sin JS, soporta abrir en pestaña nueva, etc.).

export const KPI_SECTION_LINKS_DEFAULT = [
  { id: "score", label: "Score" },
  { id: "carga", label: "Carga" },
  { id: "cumplimiento", label: "Cumplimiento" },
  { id: "alertas", label: "Alertas" },
  { id: "prediccion", label: "Predicción" },
  { id: "tareas", label: "Tareas" },
];

export function KpiSectionNav({ links = KPI_SECTION_LINKS_DEFAULT }: { links?: Array<{ id: string; label: string }> }) {
  return (
    <nav className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-surface/95 backdrop-blur border-b border-border overflow-x-auto">
      <div className="flex items-center gap-1.5 w-max">
        {links.map((l) => (
          <a
            key={l.id}
            href={`#${l.id}`}
            className="px-2.5 py-1 rounded-full text-xs font-medium text-secondary hover:text-title hover:bg-surface2 transition-colors whitespace-nowrap"
          >
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

// ── Nivel de madurez del dato (§S2-H) ────────────────────────────────────────
// Estrellas 1-5 según cuántos datos reales respaldan el KPI (más historial/
// registro = más estrellas) — puramente informativo, no altera el cálculo.

export function MaturityStars({ level, title }: { level: 1 | 2 | 3 | 4 | 5; title: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px]" title={title} aria-label={title}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= level ? "text-warning" : "text-disabled/40"}>★</span>
      ))}
    </span>
  );
}

/** Cumplimiento/carga: más tareas o días con registro en el período → más estrellas. */
export function maturityFromCount(count: number, thresholds: [number, number, number, number] = [1, 3, 6, 10]): 1 | 2 | 3 | 4 | 5 {
  const [t1, t2, t3, t4] = thresholds;
  if (count >= t4) return 5;
  if (count >= t3) return 4;
  if (count >= t2) return 3;
  if (count >= t1) return 2;
  return 1;
}

/** Predicción: más semanas de historial disponibles → más estrellas. */
export function maturityFromWeeks(weeksOfData: number): 1 | 2 | 3 | 4 | 5 {
  if (weeksOfData >= 6) return 5;
  if (weeksOfData >= 4) return 4;
  if (weeksOfData >= 2) return 3;
  if (weeksOfData >= 1) return 2;
  return 1;
}

// ── Explicabilidad genérica — "Ver cálculo" (§7) ─────────────────────────────

/** Un factor con desglose raw→normalizado→peso→contribución (§Sprint 5 S5-J). */
type ExplainFactor = { name: string; rawLabel: string; normalizedValue: number; weight: number; points: number };

export function ExplainModal({
  title,
  formula,
  steps,
  factors,
  engineVersion,
  formulaSetVersion,
  onClose,
}: {
  title: string;
  formula: string;
  steps: string[];
  /** Si se pasa, se muestra un desglose visual por factor (valor original → normalización → peso → contribución) en vez de/además de los `steps` textuales — ver Sprint 5 § S5-J. */
  factors?: ExplainFactor[];
  engineVersion?: string;
  formulaSetVersion?: string;
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

        {factors ? (
          <div className="space-y-3 mb-3">
            {factors.map((f) => (
              <div key={f.name} className="rounded-xl border border-border bg-background p-3">
                <p className="text-xs font-semibold text-title mb-2">{f.name}</p>
                <div className="flex items-center justify-between text-[11px] text-secondary">
                  <span>Valor original</span>
                  <span className="font-mono text-main">{f.rawLabel}</span>
                </div>
                <div className="text-center text-disabled text-xs">↓</div>
                <div className="flex items-center justify-between text-[11px] text-secondary">
                  <span>Normalizado</span>
                  <span className="font-mono text-main">{f.normalizedValue}</span>
                </div>
                <div className="text-center text-disabled text-xs">↓</div>
                <div className="flex items-center justify-between text-[11px] text-secondary">
                  <span>Peso</span>
                  <span className="font-mono text-main">{f.weight}%</span>
                </div>
                <div className="text-center text-disabled text-xs">↓</div>
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-title">Contribución</span>
                  <span className="text-primary">{f.points} pts</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ol className="space-y-1.5 mb-3 list-decimal list-inside">
            {steps.map((s, i) => (
              <li key={i} className="text-sm text-title">{s}</li>
            ))}
          </ol>
        )}

        {(engineVersion || formulaSetVersion) && (
          <p className="text-[11px] text-disabled pt-3 border-t border-border">
            {engineVersion && <>Motor: Analytics Engine v{engineVersion}</>}
            {engineVersion && formulaSetVersion && " · "}
            {formulaSetVersion && <>Fórmulas v{formulaSetVersion}</>}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Score de Salud Laboral (§3) ────────────────────────────────────────────────

const CLASS_TEXT: Record<string, string> = { Excelente: "text-success", Bueno: "text-success", Riesgo: "text-warning", Crítico: "text-danger" };
const CLASS_RING: Record<string, string> = { Excelente: "ring-success/25", Bueno: "ring-success/25", Riesgo: "ring-warning/25", Crítico: "ring-danger/25" };
const CLASS_EMOJI: Record<string, string> = { Excelente: "🟢", Bueno: "🟢", Riesgo: "🟡", Crítico: "🔴" };

/** Barra de score con zonas de color (§S2-B): 0-40 rojo, 40-70 amarillo, 70-90 verde, 90-100 verde intenso. */
export function ScoreZoneBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="w-full">
      <div className="relative h-2 rounded-full overflow-hidden flex">
        <div className="h-full bg-danger" style={{ width: "40%" }} />
        <div className="h-full bg-warning" style={{ width: "30%" }} />
        <div className="h-full bg-success/70" style={{ width: "20%" }} />
        <div className="h-full bg-success" style={{ width: "10%" }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-title ring-2 ring-surface shadow"
          style={{ left: `${clamped}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-disabled mt-1">
        <span>0</span>
        <span style={{ marginLeft: "26%" }}>40</span>
        <span style={{ marginLeft: "18%" }}>70</span>
        <span>100</span>
      </div>
    </div>
  );
}

export function HealthScoreCard({ result, onExplain }: { result: HealthScoreResult; onExplain: () => void }) {
  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Score de Salud Laboral</h3>
        <button onClick={onExplain} className="text-xs font-medium text-primary hover:text-primary-hover">Ver cálculo</button>
      </div>
      <p className="text-[10px] font-semibold text-disabled bg-surface2 inline-block px-2 py-0.5 rounded-full mb-3">
        Legacy — será retirado en una versión futura
      </p>
      <div className="flex items-center gap-4 mb-3">
        <div className={`w-20 h-20 rounded-full ring-4 ${CLASS_RING[result.classification]} bg-background flex flex-col items-center justify-center shrink-0`}>
          <span className="text-2xl font-extrabold text-title leading-none">{Math.round(result.score)}</span>
          <span className="text-[10px] text-disabled leading-none mt-0.5">/100</span>
        </div>
        <p className={`text-lg font-bold ${CLASS_TEXT[result.classification]}`}>{CLASS_EMOJI[result.classification]} {result.classification}</p>
      </div>
      <div className="mb-4">
        <ScoreZoneBar score={result.score} />
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

// ── Performance Score (§Sprint 5 S5-B) ──────────────────────────────────────────
// Responde una sola pregunta: "¿qué tan bien está ejecutando su trabajo?" — NO
// mezcla carga/capacidad/riesgo (eso vive en Operational Risk, ver más abajo).

export function PerformanceScoreCard({ result, onExplain }: { result: PerformanceScoreResult; onExplain: () => void }) {
  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Performance Score</h3>
        <button onClick={onExplain} className="text-xs font-medium text-primary hover:text-primary-hover">Ver cálculo</button>
      </div>
      <p className="text-[10px] font-semibold text-primary bg-primary-surface inline-block px-2 py-0.5 rounded-full mb-3">
        Nuevo — Analytics Engine v{result.engineVersion}
      </p>
      <div className="flex items-center gap-4 mb-3">
        <div className={`w-20 h-20 rounded-full ring-4 ${CLASS_RING[result.classification]} bg-background flex flex-col items-center justify-center shrink-0`}>
          <span className="text-2xl font-extrabold text-title leading-none">{Math.round(result.score)}</span>
          <span className="text-[10px] text-disabled leading-none mt-0.5">/100</span>
        </div>
        <p className={`text-lg font-bold ${CLASS_TEXT[result.classification]}`}>{CLASS_EMOJI[result.classification]} {result.classification}</p>
      </div>
      <div className="mb-4">
        <ScoreZoneBar score={result.score} />
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

// ── Benchmarks + Tendencias (§Sprint 5 S5-H/S5-I) ───────────────────────────────

function TrendLine({ label, trend }: { label: string; trend: TrendResult }) {
  if (!trend.available) {
    return (
      <div className="flex items-center justify-between text-[11px] py-0.5">
        <span className="text-disabled">{label}</span>
        <span className="text-disabled italic">{trend.reason}</span>
      </div>
    );
  }
  const arrow = trend.direction === "mejora" ? "▲" : trend.direction === "empeoro" ? "▼" : "=";
  const color = trend.direction === "mejora" ? "text-success" : trend.direction === "empeoro" ? "text-danger" : "text-disabled";
  return (
    <div className="flex items-center justify-between text-[11px] py-0.5">
      <span className="text-disabled">{label}</span>
      <span className={`font-semibold ${color}`}>{arrow} {Math.abs(trend.absoluteDiff)} pts</span>
    </div>
  );
}

function BenchmarkColumn({
  title,
  metric,
  trend,
}: {
  title: string;
  metric: BenchmarkResult["performance"];
  trend: ScoreTrendHistory;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <p className="text-xs font-semibold text-title mb-2">{title}</p>
      {!metric.available ? (
        <p className="text-xs text-disabled italic">{metric.reason}</p>
      ) : (
        <>
          <p className="text-2xl font-extrabold text-title leading-none mb-2">{metric.value}</p>
          <div className="text-[11px] text-secondary space-y-0.5 mb-2">
            <div className="flex items-center justify-between">
              <span>Promedio del equipo</span>
              <span className="font-semibold text-main">{metric.teamAverage}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Percentil</span>
              <span className="font-semibold text-main">{metric.percentile}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Posición</span>
              <span className="font-semibold text-primary">Top {metric.topPct}%</span>
            </div>
          </div>
        </>
      )}
      <div className="pt-2 border-t border-border">
        <TrendLine label="vs. semana anterior" trend={trend.semanaAnterior} />
        <TrendLine label="vs. mes anterior" trend={trend.mesAnterior} />
        <TrendLine label="vs. promedio 6 meses" trend={trend.promedio6Meses} />
      </div>
    </div>
  );
}

export function BenchmarkCard({ userId }: { userId: string }) {
  const [data, setData] = useState<{ benchmark: BenchmarkResult; trends: { performance: ScoreTrendHistory; operationalRisk: ScoreTrendHistory } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
    return <div className="text-sm text-disabled text-center py-6">No se pudieron cargar los benchmarks.</div>;
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Benchmarks y tendencias</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BenchmarkColumn title="Performance Score" metric={data.benchmark.performance} trend={data.trends.performance} />
        <BenchmarkColumn title="Operational Risk" metric={data.benchmark.operationalRisk} trend={data.trends.operationalRisk} />
      </div>
    </div>
  );
}

// ── Motor de alertas (§1) ──────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<string, string> = { red: "Acción inmediata", orange: "Revisar esta semana", yellow: "Monitorear", green: "Informativo" };
const SEVERITY_EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢" };
const SEVERITY_TEXT: Record<string, string> = { red: "text-danger", orange: "text-orange-500", yellow: "text-warning", green: "text-success" };
const SEVERITY_BG: Record<string, string> = { red: "bg-danger/[.08]", orange: "bg-orange-500/[.08]", yellow: "bg-warning/[.1]", green: "bg-success/[.08]" };

export function EngineAlertsCard({ alerts, history = [] }: { alerts: EngineAlert[]; history?: ResolvedAlert[] }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Alertas automáticas</h3>
        {alerts.length > 0 && <span className="text-xs font-bold text-danger bg-danger/[.15] px-2 py-0.5 rounded-full">{alerts.length}</span>}
      </div>
      {alerts.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-success flex items-center gap-2">
            ✅ Sin alertas críticas activas
          </p>
          {history.length > 0 && (
            <div className="pt-2 border-t border-border space-y-1">
              {history.map((h) => (
                <p key={h.rule} className="text-xs text-secondary">
                  Última alerta resuelta: hace {h.daysAgo} {h.daysAgo === 1 ? "día" : "días"} — &quot;{h.message}&quot;{" "}
                  <span className="text-success font-semibold">Resuelta ✓</span>
                </p>
              ))}
            </div>
          )}
        </div>
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
  const v2 = isFeatureEnabled("enableConsistencyV2");
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Consistencia</h3>
      {!result.available ? (
        <p className="text-sm text-disabled italic">{result.reason}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            {v2 && <span className={`text-2xl font-extrabold ${CONSISTENCY_COLOR[result.level]}`}>{result.consistencyPct}%</span>}
            <span className={`${v2 ? "text-sm" : "text-xl"} font-semibold ${CONSISTENCY_COLOR[result.level]}`}>{result.label}</span>
          </div>
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
  const v2 = isFeatureEnabled("enablePredictionV2");
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Predicción</h3>
        {result.available && (
          <span className="flex items-center gap-2">
            {v2 && (
              <MaturityStars
                level={maturityFromWeeks(result.weeksOfData)}
                title={`Madurez del dato: basado en ${result.weeksOfData} ${result.weeksOfData === 1 ? "semana" : "semanas"} de historial`}
              />
            )}
            <span className={`text-[11px] font-semibold ${CONFIDENCE_COLOR[result.confidence]}`}>
              {v2 ? `Confianza: ${result.confidencePct}%` : CONFIDENCE_LABEL[result.confidence]}
            </span>
          </span>
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
            <span className="text-secondary">Cumplimiento proyectado</span>
            <span className="font-semibold text-main">
              {result.cumplimientoEstimadoCierreMes}%
              {v2 && (
                <span className="text-disabled font-normal"> [{result.cumplimientoEstimadoRango.min}%-{result.cumplimientoEstimadoRango.max}%]</span>
              )}
            </span>
          </div>
          {result.horasParaRangoOptimo > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-secondary">Horas para alcanzar rango óptimo</span>
              <span className="font-semibold text-main">{result.horasParaRangoOptimo}h</span>
            </div>
          )}
          <p className="text-[10px] text-disabled pt-1.5 border-t border-border mt-1.5">
            {CONFIDENCE_LABEL[result.confidence]}{v2 ? ` (${result.confidencePct}%)` : ""} · basado en {result.weeksOfData} {result.weeksOfData === 1 ? "semana" : "semanas"} de datos · proyección máxima {result.maxProjectionDays} días
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
  const [explainLegacyOpen, setExplainLegacyOpen] = useState(false);
  const [explainPerfOpen, setExplainPerfOpen] = useState(false);

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
      <p className="text-[11px] text-disabled flex flex-wrap gap-x-1.5">
        <span>Datos calculados: {formatDateTime(data.lastUpdated)}</span>
        <span>·</span>
        <span>Motor: Analytics Engine v{data.engineVersion}</span>
        <span>·</span>
        <span>Fórmulas v{data.formulaSetVersion}</span>
        <span>·</span>
        <span>Calidad de datos: {data.dataQuality.pct}%</span>
        <span>·</span>
        <span>Caché: {data.cacheActive ? "Activo" : "Recalculado ahora"}</span>
      </p>

      {data.validationWarnings && data.validationWarnings.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/[.08] px-3.5 py-2.5">
          <p className="text-xs font-semibold text-warning mb-1">
            ⚠ Solo visible para Administrador — validación de consistencia detectó {data.validationWarnings.length} {data.validationWarnings.length === 1 ? "problema" : "problemas"}
          </p>
          <ul className="text-[11px] text-secondary space-y-0.5">
            {data.validationWarnings.map((f, i) => (
              <li key={i}>
                <span className="font-mono text-disabled">{f.rule}</span> — {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="score" className="scroll-mt-16 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PerformanceScoreCard result={data.performanceScore} onExplain={() => setExplainPerfOpen(true)} />
        <HealthScoreCard result={data.healthScore} onExplain={() => setExplainLegacyOpen(true)} />
      </div>

      <BenchmarkCard userId={userId} />

      <div id="alertas" className="scroll-mt-16">
        <EngineAlertsCard alerts={data.alerts} history={data.alertsHistory} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ConsistencyCard result={data.consistency} />
        <AnomaliesCard result={data.anomalies} />
        <div id="prediccion" className="scroll-mt-16">
          <PredictionCard result={data.prediction} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrendsCard trends={data.trends} />
        <DataQualityCard result={data.dataQuality} />
      </div>

      {explainLegacyOpen && (
        <ExplainModal
          title="Score de Salud Laboral (Legacy)"
          formula={data.healthScore.explain.formula}
          steps={data.healthScore.explain.steps}
          engineVersion={data.engineVersion}
          onClose={() => setExplainLegacyOpen(false)}
        />
      )}
      {explainPerfOpen && (
        <ExplainModal
          title="Performance Score"
          formula={data.performanceScore.explain.formula}
          steps={data.performanceScore.explain.steps}
          factors={data.performanceScore.factors}
          engineVersion={data.engineVersion}
          formulaSetVersion={data.formulaSetVersion}
          onClose={() => setExplainPerfOpen(false)}
        />
      )}
    </div>
  );
}
