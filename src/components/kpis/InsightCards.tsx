"use client";

import { useEffect, useState } from "react";
import type { PriorityCompliance } from "./types";

// ── Task breakdown (reemplaza el número simple de "Total tareas") ───────────

export function TaskBreakdownCard({
  total,
  completed,
  inProgress,
  pending,
}: {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="rounded-[14px] border border-border bg-background p-5">
      <p className="text-xs font-medium text-secondary mb-1">Total tareas</p>
      <p className="text-3xl font-bold text-main mb-2.5">{total}</p>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-surface2 mb-3">
        {completed > 0 && <div className="bg-success" style={{ width: `${pct(completed)}%` }} />}
        {inProgress > 0 && <div className="bg-primary" style={{ width: `${pct(inProgress)}%` }} />}
        {pending > 0 && <div className="bg-disabled/40" style={{ width: `${pct(pending)}%` }} />}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-secondary">✅ Completadas</span>
          <span className="font-semibold text-title">{completed}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-secondary">🔵 En progreso</span>
          <span className="font-semibold text-title">{inProgress}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-secondary">⭕ Pendientes</span>
          <span className="font-semibold text-title">{pending}</span>
        </div>
      </div>
    </div>
  );
}

// ── Cumplimiento por prioridad ───────────────────────────────────────────────

const PRIORITY_ICON: Record<PriorityCompliance["priority"], string> = {
  ALTA: "🔴",
  MEDIA: "🟡",
  BAJA: "🟢",
};

const PRIORITY_LABEL: Record<PriorityCompliance["priority"], string> = {
  ALTA: "Urgentes/Alta",
  MEDIA: "Media",
  BAJA: "Baja",
};

function resultBarClass(pct: number): string {
  if (pct >= 80) return "bg-success";
  if (pct >= 60) return "bg-warning";
  return "bg-danger";
}

export function PriorityComplianceCard({ data }: { data: PriorityCompliance[] }) {
  const alta = data.find((d) => d.priority === "ALTA");
  const showAltaAlert = !!alta && alta.total > 0 && alta.pct < 70;

  return (
    <div className="rounded-[14px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Cumplimiento por prioridad</h3>
      <div className="space-y-2.5">
        {data.map((d) => (
          <div key={d.priority} className="flex items-center gap-3">
            <span className="text-sm shrink-0" aria-hidden>{PRIORITY_ICON[d.priority]}</span>
            <span className="text-sm text-main w-32 shrink-0">
              {PRIORITY_LABEL[d.priority]}
              <span className="text-disabled font-normal"> ({d.total} {d.total === 1 ? "tarea" : "tareas"})</span>
            </span>
            {d.total === 0 ? (
              <span className="text-xs text-disabled">Sin tareas de esta prioridad</span>
            ) : (
              <>
                <div className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden">
                  <div className={`h-full rounded-full ${resultBarClass(d.pct)}`} style={{ width: `${d.pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-main w-10 text-right shrink-0">{d.pct}%</span>
              </>
            )}
          </div>
        ))}
      </div>
      {showAltaAlert && (
        <p className="text-xs text-danger font-medium mt-3 pt-3 border-t border-border">
          ⚠️ Cumplimiento de tareas de prioridad Alta por debajo del mínimo aceptable ({alta!.pct}%) — requiere atención inmediata.
        </p>
      )}
    </div>
  );
}

// ── Insights de Nova (IA, cache 4h) ──────────────────────────────────────────

type NovaMode = "full" | "insights-only" | "motivational";
type NovaInsightData = {
  mode: NovaMode;
  hallazgoPrincipal?: string;
  riesgos?: string[];
  aspectosPositivos?: string[];
  recomendaciones?: string[];
  messages?: string[];
};

const NOVA_TITLE: Record<NovaMode, string> = {
  full: "Análisis del período",
  "insights-only": "Análisis del período",
  motivational: "Tu resumen del mes",
};

export function NovaInsightsCard({ userId, month }: { userId: string; month: string }) {
  const [data, setData] = useState<NovaInsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      setData(null);
      try {
        const res = await fetch(`/api/kpis/nova-insights/${userId}?month=${month}`);
        if (!res.ok) throw new Error("failed");
        const json: NovaInsightData = await res.json();
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
  }, [userId, month]);

  const isMotivational = data?.mode === "motivational";

  return (
    <div className="rounded-[14px] p-5 bg-nova-soft">
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-[9px] shrink-0 flex items-center justify-center text-white"
          style={{ background: "var(--gradient-nova)" }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.415 2.798H4.213c-1.444 0-2.414-1.798-1.414-2.798L4.8 15.3" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-nova mb-2">{data ? NOVA_TITLE[data.mode] : "Análisis del período"}</p>
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-3 rounded bg-black/10 dark:bg-white/10 animate-pulse" style={{ width: `${85 - i * 10}%` }} />
              ))}
            </div>
          )}
          {!loading && error && (
            <p className="text-sm text-disabled">No se pudo generar el análisis. Intenta de nuevo.</p>
          )}
          {!loading && !error && data && isMotivational && (
            <ul className="space-y-1.5">
              {(data.messages ?? []).map((m, i) => (
                <li key={i} className="text-sm text-title leading-relaxed flex gap-2">
                  <span className="text-nova shrink-0">✨</span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && data && !isMotivational && (
            <div className="space-y-3">
              {data.hallazgoPrincipal && (
                <div>
                  <p className="text-[11px] font-semibold text-nova uppercase tracking-wider mb-1">Hallazgo principal</p>
                  <p className="text-sm text-title leading-relaxed font-medium">{data.hallazgoPrincipal}</p>
                </div>
              )}
              {data.riesgos && data.riesgos.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-danger uppercase tracking-wider mb-1">Riesgos detectados</p>
                  <ul className="space-y-1.5">
                    {data.riesgos.map((r, i) => (
                      <li key={i} className="text-sm text-title leading-relaxed flex gap-2">
                        <span className="text-danger shrink-0">–</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.aspectosPositivos && data.aspectosPositivos.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-success uppercase tracking-wider mb-1">Aspectos positivos</p>
                  <ul className="space-y-1.5">
                    {data.aspectosPositivos.map((a, i) => (
                      <li key={i} className="text-sm text-title leading-relaxed flex gap-2">
                        <span className="text-success shrink-0">–</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.recomendaciones && data.recomendaciones.length > 0 && (
                <div className="pt-3 border-t border-nova/20">
                  <p className="text-[11px] font-semibold text-nova uppercase tracking-wider mb-1.5">Recomendaciones priorizadas</p>
                  <ul className="space-y-1.5">
                    {data.recomendaciones.map((r, i) => (
                      <li key={i} className="text-sm text-title leading-relaxed flex gap-2 font-medium">
                        <span className="text-nova shrink-0">⚡</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
