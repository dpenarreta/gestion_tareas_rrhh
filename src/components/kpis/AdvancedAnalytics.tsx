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
} from "./types";
import type { ResolvedAlert } from "@/lib/analytics";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { SmartBenchmarkPanel } from "./SmartBenchmark";
import TargetTimePrecisionCard from "./TargetTimePrecisionCard";
import {
  scoreLevel,
  scoreLevelExplanation,
  confidenceLabel,
  reliabilityPctFromStars,
  derivedNormalizedValue,
  maturityFromWeeks,
  CONFIDENCE_TOOLTIPS,
  CONSISTENCY_FALLBACK_NOTE,
  SCORE_CLASSIFICATION_REFERENCE,
  INDICATOR_HELP,
  type ConfidenceIndicators,
  type IndicatorHelp,
} from "@/lib/analyticsExplain";

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
  { id: "tiempo-objetivo", label: "Tiempo Objetivo" },
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

// ── Tooltips educativos (§Sprint 6.5 S6.5-K) ─────────────────────────────────

/** Ayuda contextual accesible (title nativo) sobre un concepto — sin JS extra, funciona con teclado y lectores de pantalla. */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      tabIndex={0}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface2 text-disabled text-[9px] font-bold leading-none cursor-help shrink-0 hover:bg-primary-surface hover:text-primary transition-colors"
    >
      i
    </span>
  );
}

// ── Ayuda contextual de 4 partes (§Sprint A §6) ──────────────────────────────
// A diferencia de InfoTooltip (hover, una línea), esto abre al click un
// modal con las 4 secciones (qué significa/cómo se calcula/por qué importa/
// buenas prácticas) — necesario para contenido más largo. Solo texto estático
// de `INDICATOR_HELP` (analyticsExplain.ts), sin cálculo ni fetch.

function HelpModal({ title, help, onClose }: { title: string; help: IndicatorHelp; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">{title}</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Qué significa</p>
            <p className="text-title">{help.meaning}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Cómo se calcula</p>
            <p className="text-title">{help.howCalculated}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Por qué importa</p>
            <p className="text-title">{help.whyItMatters}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Buenas prácticas</p>
            <ul className="space-y-1">
              {help.bestPractices.map((b, i) => (
                <li key={i} className="text-title flex items-start gap-1.5">
                  <span className="text-primary shrink-0">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Botón "?" que abre `HelpModal` — mismo estilo visual que `InfoTooltip`, pero interactivo (click, no solo hover) para contenido de 4 secciones. */
export function HelpPopover({ title, help }: { title: string; help: IndicatorHelp }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ayuda: ${title}`}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface2 text-disabled text-[9px] font-bold leading-none cursor-help shrink-0 hover:bg-primary-surface hover:text-primary transition-colors"
      >
        ?
      </button>
      {open && <HelpModal title={title} help={help} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Confianza del cálculo (§Sprint 6.5 S6.5-G) ───────────────────────────────
// Dos indicadores DISTINTOS: Calidad del dato (completitud) y Confiabilidad
// del cálculo (solidez estadística) — nunca se combinan en un solo número.

export function ConfidenceBadges({ dataQualityPct, reliabilityPct, compact = false }: ConfidenceIndicators & { compact?: boolean }) {
  const dqColor = dataQualityPct >= 90 ? "text-success" : dataQualityPct >= 70 ? "text-warning" : "text-danger";
  const relColor = reliabilityPct >= 90 ? "text-success" : reliabilityPct >= 70 ? "text-warning" : "text-danger";
  return (
    <div className={compact ? "flex items-center gap-3 text-[11px]" : "grid grid-cols-2 gap-2"}>
      <div className={compact ? "flex items-center gap-1" : "rounded-lg border border-border bg-background px-3 py-2"}>
        <span className="flex items-center gap-1 text-disabled">
          Calidad del dato <InfoTooltip text={CONFIDENCE_TOOLTIPS.dataQuality} />
        </span>
        <span className={`font-bold ${dqColor} ${compact ? "ml-1" : "block text-base"}`}>{dataQualityPct}%</span>
      </div>
      <div className={compact ? "flex items-center gap-1" : "rounded-lg border border-border bg-background px-3 py-2"}>
        <span className="flex items-center gap-1 text-disabled">
          Confiabilidad del cálculo <InfoTooltip text={CONFIDENCE_TOOLTIPS.reliability} />
        </span>
        <span className={`font-bold ${relColor} ${compact ? "ml-1" : "block text-base"}`}>{reliabilityPct}% <span className="font-normal text-disabled">({confidenceLabel(reliabilityPct)})</span></span>
      </div>
    </div>
  );
}

// ── Explicabilidad genérica — "¿Cómo se obtuvo este resultado?" (§Sprint 6.5 S6.5-E) ──

/** Un factor con desglose raw→nivel→puntaje→peso→aporte (§Sprint 5 S5-J, ampliado en Sprint 6.5). */
export type ExplainFactor = {
  name: string;
  rawLabel: string;
  normalizedValue: number;
  weight: number;
  points: number;
  /** Presente cuando este factor usó una regla de respaldo (p. ej. consistencia sin historial suficiente) — ver Sprint 6.5 § S6.5-F. Nunca se muestra el puntaje de respaldo sin esta explicación. */
  fallbackNote?: string;
};

function ExplainFactorCard({ f }: { f: ExplainFactor }) {
  const level = scoreLevel(f.normalizedValue);
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-xs font-semibold text-title mb-2">{f.name}</p>
      <div className="flex items-center justify-between text-[11px] text-secondary">
        <span>Valor original</span>
        <span className="font-mono text-main">{f.rawLabel}</span>
      </div>
      <div className="text-center text-disabled text-xs">↓</div>
      <div className="flex items-center justify-between text-[11px] text-secondary">
        <span>Nivel obtenido</span>
        <span className="font-mono text-main">{level}</span>
      </div>
      <div className="text-center text-disabled text-xs">↓</div>
      <div className="flex items-center justify-between text-[11px] text-secondary">
        <span>Puntaje obtenido</span>
        <span className="font-mono text-main">{f.normalizedValue}/100</span>
      </div>
      <div className="text-center text-disabled text-xs">↓</div>
      <div className="flex items-center justify-between text-[11px] text-secondary">
        <span>Peso aplicado</span>
        <span className="font-mono text-main">{f.weight}%</span>
      </div>
      <div className="text-center text-disabled text-xs">↓</div>
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-title">Aporte al resultado</span>
        <span className="text-primary">{f.points} pts</span>
      </div>
      {f.fallbackNote ? (
        <p className="text-[11px] text-warning bg-warning/[.1] rounded-lg px-2.5 py-2 mt-2.5 leading-relaxed">{f.fallbackNote}</p>
      ) : (
        <p className="text-[10px] text-disabled mt-2 leading-relaxed">{scoreLevelExplanation(f.normalizedValue)}</p>
      )}
    </div>
  );
}

export function ExplainModal({
  title,
  formula,
  steps,
  factors,
  dataUsed,
  resultValue,
  resultInterpretation,
  engineVersion,
  formulaSetVersion,
  lastUpdated,
  dataSource,
  referenceUsed,
  confidence,
  onClose,
}: {
  title: string;
  formula: string;
  steps: string[];
  /** Si se pasa, se muestra un desglose visual por factor (valor original → nivel → puntaje → peso → aporte) en vez de/además de los `steps` textuales — ver Sprint 5 § S5-J. */
  factors?: ExplainFactor[];
  /** Checklist de "DATOS UTILIZADOS" (§Sprint 6.5 S6.5-D) — p. ej. ["124 tareas analizadas", "16 semanas evaluadas"]. */
  dataUsed?: string[];
  /** Bloque 4 "RESULTADO FINAL" (§S6.5-E) — puntaje final y su interpretación ejecutiva. */
  resultValue?: number;
  resultInterpretation?: string;
  engineVersion?: string;
  formulaSetVersion?: string;
  /** Fecha del cálculo, ISO — para el resumen de auditoría (§S6.5-J). */
  lastUpdated?: string;
  /** Fuente de datos usada — para el resumen de auditoría (§S6.5-J). */
  dataSource?: string;
  /** Referencia utilizada para interpretar este indicador — para el resumen de auditoría (§S6.5-J). */
  referenceUsed?: string;
  confidence?: ConfidenceIndicators;
  onClose: () => void;
}) {
  const hasAudit = Boolean(engineVersion || formulaSetVersion || lastUpdated || dataSource || referenceUsed || confidence);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">¿Cómo se obtuvo este resultado? — {title}</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-secondary mb-3">
          Fórmula: <code className="text-title bg-background px-1.5 py-0.5 rounded">{formula}</code>
        </p>

        {dataUsed && dataUsed.length > 0 && (
          <div className="rounded-xl border border-border bg-background p-3 mb-3">
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
        )}

        {factors ? (
          <div className="space-y-3 mb-3">
            {factors.map((f) => (
              <ExplainFactorCard key={f.name} f={f} />
            ))}
          </div>
        ) : (
          <ol className="space-y-1.5 mb-3 list-decimal list-inside">
            {steps.map((s, i) => (
              <li key={i} className="text-sm text-title">{s}</li>
            ))}
          </ol>
        )}

        {(resultValue !== undefined || resultInterpretation) && (
          <div className="rounded-xl border border-primary/25 bg-primary-surface/40 p-3 mb-3">
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Resultado final</p>
            <div className="flex items-baseline gap-2">
              {resultValue !== undefined && <span className="text-2xl font-extrabold text-title">{resultValue}</span>}
              {resultInterpretation && <span className="text-sm font-semibold text-primary">{resultInterpretation}</span>}
            </div>
          </div>
        )}

        {confidence && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Confianza del cálculo</p>
            <ConfidenceBadges {...confidence} />
          </div>
        )}

        {hasAudit && (
          <div className="pt-3 mt-1 border-t border-border">
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Resumen de auditoría</p>
            <div className="space-y-1 text-[11px] text-secondary">
              {lastUpdated && (
                <div className="flex items-center justify-between">
                  <span>Fecha del cálculo</span>
                  <span className="text-title font-medium">{formatDateTime(lastUpdated)}</span>
                </div>
              )}
              {engineVersion && (
                <div className="flex items-center justify-between">
                  <span>Versión del motor</span>
                  <span className="text-title font-medium">Analytics Engine v{engineVersion}</span>
                </div>
              )}
              {formulaSetVersion && (
                <div className="flex items-center justify-between">
                  <span>Versión de fórmulas</span>
                  <span className="text-title font-medium">v{formulaSetVersion}</span>
                </div>
              )}
              {dataSource && (
                <div className="flex items-center justify-between">
                  <span>Fuente de datos</span>
                  <span className="text-title font-medium text-right">{dataSource}</span>
                </div>
              )}
              {referenceUsed && (
                <div className="flex items-center justify-between">
                  <span>Referencia utilizada</span>
                  <span className="text-title font-medium text-right">{referenceUsed}</span>
                </div>
              )}
              {confidence && (
                <>
                  <div className="flex items-center justify-between">
                    <span>Calidad del dato</span>
                    <span className="text-title font-medium">{confidence.dataQualityPct}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Confiabilidad</span>
                    <span className="text-title font-medium">{confidence.reliabilityPct}%</span>
                  </div>
                </>
              )}
            </div>
          </div>
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
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
          Score de Salud Laboral <HelpPopover title="Score de Salud Laboral" help={INDICATOR_HELP.scoreSalud} />
        </h3>
        <button onClick={onExplain} className="text-xs font-medium text-primary hover:text-primary-hover">¿Cómo se obtuvo este resultado?</button>
      </div>
      <p className="text-[10px] font-semibold text-disabled bg-surface2 inline-block px-2 py-0.5 rounded-full mb-3">
        Versión anterior — será retirada en una versión futura
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

export function PerformanceScoreCard({ result, onExplain, confidence }: { result: PerformanceScoreResult; onExplain: () => void; confidence?: ConfidenceIndicators }) {
  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
          Performance Score <HelpPopover title="Performance Score" help={INDICATOR_HELP.performanceScore} />
        </h3>
        <button onClick={onExplain} className="text-xs font-medium text-primary hover:text-primary-hover">¿Cómo se obtuvo este resultado?</button>
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
      <div className="space-y-1.5 mb-3">
        {result.factors.map((f) => (
          <div key={f.name} className="flex items-center justify-between text-xs">
            <span className="text-secondary flex items-center gap-1">
              {f.name} <span className="text-disabled">({f.rawLabel})</span>
              {f.name === "Índice de Trazabilidad" && <HelpPopover title="Índice de Trazabilidad" help={INDICATOR_HELP.trazabilidad} />}
            </span>
            <span className="font-semibold text-main">{f.points} pts</span>
          </div>
        ))}
      </div>
      {confidence && (
        <div className="pt-2 border-t border-border">
          <ConfidenceBadges {...confidence} compact />
        </div>
      )}
    </div>
  );
}

// ── Benchmarks (§Sprint 7 — Motor de Benchmarks Inteligente) ────────────────
// Ver src/components/kpis/SmartBenchmark.tsx — reemplaza por completo el
// benchmark de pares de Sprint 5 (BenchmarkCard/BenchmarkColumn/TrendLine),
// que aquí vivían antes.

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

export function ConsistencyCard({ result, dataQualityPct }: { result: ConsistencyResult; dataQualityPct?: number }) {
  const v2 = isFeatureEnabled("enableConsistencyV2");
  const [explainOpen, setExplainOpen] = useState(false);
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
          Consistencia <HelpPopover title="Consistencia" help={INDICATOR_HELP.consistencia} />
        </h3>
        {result.available && (
          <button onClick={() => setExplainOpen(true)} className="text-xs font-medium text-primary hover:text-primary-hover">
            ¿Cómo se obtuvo este resultado?
          </button>
        )}
      </div>
      {!result.available ? (
        <p className="text-sm text-disabled italic">{result.reason}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            {v2 && <span className={`text-2xl font-extrabold ${CONSISTENCY_COLOR[result.level]}`}>{result.consistencyPct}%</span>}
            <span className={`${v2 ? "text-sm" : "text-xl"} font-semibold ${CONSISTENCY_COLOR[result.level]}`}>{result.label}</span>
          </div>
          <p className="text-xs text-secondary mt-1">
            Variabilidad: {result.coefficientOfVariation}% (CV) — {result.interpretation}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <MaturityStars level={result.reliability.stars} title={result.reliability.label} />
            <span className="text-[11px] text-disabled">
              {result.reliability.label} · {result.weeksAnalyzed >= 1 ? `${result.weeksAnalyzed} ${result.weeksAnalyzed === 1 ? "semana" : "semanas"} con datos válidos` : `${result.daysAnalyzed} ${result.daysAnalyzed === 1 ? "día analizado" : "días analizados"}`}
            </span>
          </div>
        </>
      )}
      {explainOpen && result.available && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setExplainOpen(false)} />
          <div className="relative w-full max-w-md bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-title uppercase tracking-wider">¿Cómo se obtuvo este resultado? — Consistencia</h3>
              <button onClick={() => setExplainOpen(false)} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-secondary mb-3">
              La Variabilidad (CV, Coeficiente de Variación) mide cuánto varía su carga/cumplimiento semana a semana — mientras más bajo, más estable. Se calcula únicamente sobre semanas con datos reales, nunca sobre semanas anteriores al inicio de su historial.
            </p>
            <div className="rounded-xl border border-border bg-background p-3 mb-3">
              <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Datos utilizados</p>
              <ul className="space-y-1">
                <li className="text-xs text-title flex items-start gap-1.5"><span className="text-success shrink-0">✓</span><span>{result.weeksAnalyzed} {result.weeksAnalyzed === 1 ? "semana evaluada" : "semanas evaluadas"}</span></li>
                <li className="text-xs text-title flex items-start gap-1.5"><span className="text-success shrink-0">✓</span><span>{result.daysAnalyzed} {result.daysAnalyzed === 1 ? "día con actividad" : "días con actividad"}</span></li>
              </ul>
            </div>
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Semanas utilizadas</p>
            {result.explain.periodsUsed.length === 0 ? (
              <p className="text-xs text-disabled italic mb-3">Ninguna.</p>
            ) : (
              <ul className="text-xs text-title mb-3 list-disc list-inside space-y-0.5">
                {result.explain.periodsUsed.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {result.explain.periodsExcluded.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Semanas excluidas</p>
                <ul className="text-xs text-disabled mb-3 list-disc list-inside space-y-0.5">
                  {result.explain.periodsExcluded.map((p, i) => (
                    <li key={i}>
                      {p.period} — {p.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="pt-3 border-t border-border space-y-1 mb-3">
              {result.explain.steps.map((s, i) => (
                <p key={i} className="text-xs text-main">
                  {s}
                </p>
              ))}
            </div>
            {dataQualityPct !== undefined && (
              <div className="pt-3 border-t border-border">
                <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Confianza del cálculo</p>
                <ConfidenceBadges dataQualityPct={dataQualityPct} reliabilityPct={reliabilityPctFromStars(result.reliability.stars)} />
              </div>
            )}
          </div>
        </div>
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

export function PredictionCard({ result, dataQualityPct }: { result: Prediction; dataQualityPct?: number }) {
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
          {dataQualityPct !== undefined && (
            <div className="pt-2 border-t border-border">
              <ConfidenceBadges dataQualityPct={dataQualityPct} reliabilityPct={result.confidencePct} compact />
            </div>
          )}
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

  const consistencyReliabilityPct = data.consistency.available ? reliabilityPctFromStars(data.consistency.reliability.stars) : 50;
  const sharedConfidence: ConfidenceIndicators = { dataQualityPct: data.dataQuality.pct, reliabilityPct: consistencyReliabilityPct };

  const withFallbackNote = (factors: ExplainFactor[]): ExplainFactor[] =>
    factors.map((f) => (f.name === "Consistencia" && f.rawLabel === "Sin historial suficiente" ? { ...f, fallbackNote: CONSISTENCY_FALLBACK_NOTE } : f));

  const performanceFactors = withFallbackNote(data.performanceScore.factors);
  const healthFactors: ExplainFactor[] = withFallbackNote(
    data.healthScore.factors.map((f) => ({
      name: f.name,
      rawLabel: f.rawLabel,
      normalizedValue: derivedNormalizedValue(f.points, f.weight),
      weight: f.weight,
      points: f.points,
    }))
  );

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
        <PerformanceScoreCard result={data.performanceScore} onExplain={() => setExplainPerfOpen(true)} confidence={sharedConfidence} />
        <HealthScoreCard result={data.healthScore} onExplain={() => setExplainLegacyOpen(true)} />
      </div>

      <SmartBenchmarkPanel userId={userId} />

      <div id="alertas" className="scroll-mt-16">
        <EngineAlertsCard alerts={data.alerts} history={data.alertsHistory} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ConsistencyCard result={data.consistency} dataQualityPct={data.dataQuality.pct} />
        <AnomaliesCard result={data.anomalies} />
        <div id="prediccion" className="scroll-mt-16">
          <PredictionCard result={data.prediction} dataQualityPct={data.dataQuality.pct} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrendsCard trends={data.trends} />
        <DataQualityCard result={data.dataQuality} />
      </div>

      <div id="tiempo-objetivo" className="scroll-mt-16">
        <TargetTimePrecisionCard userId={userId} />
      </div>

      {explainLegacyOpen && (
        <ExplainModal
          title="Score de Salud Laboral (Versión anterior)"
          formula={data.healthScore.explain.formula}
          steps={data.healthScore.explain.steps}
          factors={healthFactors}
          dataUsed={data.healthScore.factors.map((f) => `${f.name}: ${f.rawLabel}`)}
          resultValue={Math.round(data.healthScore.score)}
          resultInterpretation={data.healthScore.classification}
          engineVersion={data.engineVersion}
          lastUpdated={data.lastUpdated}
          dataSource="Tareas del mes en curso, carga horaria, consistencia semanal y capacidad proyectada"
          referenceUsed={SCORE_CLASSIFICATION_REFERENCE}
          confidence={sharedConfidence}
          onClose={() => setExplainLegacyOpen(false)}
        />
      )}
      {explainPerfOpen && (
        <ExplainModal
          title="Performance Score"
          formula={data.performanceScore.explain.formula}
          steps={data.performanceScore.explain.steps}
          factors={performanceFactors}
          dataUsed={data.performanceScore.factors.map((f) => `${f.name}: ${f.rawLabel}`)}
          resultValue={Math.round(data.performanceScore.score)}
          resultInterpretation={data.performanceScore.classification}
          engineVersion={data.engineVersion}
          formulaSetVersion={data.formulaSetVersion}
          lastUpdated={data.lastUpdated}
          dataSource="Tareas del mes en curso, historial semanal de registros y actividades/comentarios documentados"
          referenceUsed={SCORE_CLASSIFICATION_REFERENCE}
          confidence={sharedConfidence}
          onClose={() => setExplainPerfOpen(false)}
        />
      )}
    </div>
  );
}
