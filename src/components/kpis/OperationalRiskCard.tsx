"use client";

import { useState, useEffect } from "react";
import type { Role } from "@/generated/prisma/client";
import { canViewOperationalRisk } from "@/lib/roles";
import { isFeatureEnabled } from "@/lib/featureFlags";
import type { OperationalRiskResult } from "./types";
import { ExplainModal, InfoTooltip, ConfidenceBadges } from "./AdvancedAnalytics";
import { CONFIDENCE_TOOLTIPS, type ConfidenceIndicators } from "@/lib/analyticsExplain";

type RiskResponse = OperationalRiskResult & { confidence: ConfidenceIndicators; engineVersion: string; lastUpdated: string };

const CLASS_TEXT: Record<string, string> = { Bajo: "text-success", Medio: "text-warning", Alto: "text-orange-500", Crítico: "text-danger" };
const CLASS_RING: Record<string, string> = { Bajo: "ring-success/25", Medio: "ring-warning/25", Alto: "ring-orange-500/25", Crítico: "ring-danger/25" };
const CLASS_EMOJI: Record<string, string> = { Bajo: "🟢", Medio: "🟡", Alto: "🟠", Crítico: "🔴" };

/**
 * Índice de Riesgo Operativo individual (§13) — mide el riesgo que la
 * situación del colaborador representa para el equipo, NO evalúa a la
 * persona. Visible solo para gerencia (canViewOperationalRisk); nunca nivel 1.
 */
export default function OperationalRiskCard({ userId, currentUserRole }: { userId: string; currentUserRole: Role }) {
  const [data, setData] = useState<RiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  const canView = canViewOperationalRisk(currentUserRole) && isFeatureEnabled("enableOperationalRisk");

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/operational-risk/${userId}`);
        if (!res.ok) throw new Error("failed");
        const json: RiskResponse = await res.json();
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
  }, [userId, canView]);

  if (!canView) return null;

  if (loading) {
    return (
      <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5 flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-disabled text-center py-6">No se pudo cargar el Índice de Riesgo Operativo.</div>;
  }

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
          Índice de Riesgo Operativo <InfoTooltip text={CONFIDENCE_TOOLTIPS.operationalRisk} />
        </h3>
        <button onClick={() => setExplainOpen(true)} className="text-xs font-medium text-primary hover:text-primary-hover">¿Cómo se obtuvo este resultado?</button>
      </div>
      <p className="text-[11px] text-disabled mb-3">
        Riesgo para el equipo — complementa al Performance Score, no lo reemplaza (§Sprint 5)
      </p>

      <div className="flex items-center gap-4 mb-4">
        <div className={`w-20 h-20 rounded-full ring-4 ${CLASS_RING[data.classification]} bg-background flex flex-col items-center justify-center shrink-0`}>
          <span className="text-2xl font-extrabold text-title leading-none">{Math.round(data.score)}</span>
          <span className="text-[10px] text-disabled leading-none mt-0.5">/100</span>
        </div>
        <div>
          <p className={`text-lg font-bold ${CLASS_TEXT[data.classification]}`}>{CLASS_EMOJI[data.classification]} Riesgo {data.classification}</p>
          {data.trendVsPrevMonth.available ? (
            <p className={`text-xs font-medium mt-1 ${(data.trendVsPrevMonth.diff ?? 0) > 0 ? "text-danger" : (data.trendVsPrevMonth.diff ?? 0) < 0 ? "text-success" : "text-disabled"}`}>
              {(data.trendVsPrevMonth.diff ?? 0) > 0 ? "▲" : (data.trendVsPrevMonth.diff ?? 0) < 0 ? "▼" : "="} {Math.abs(data.trendVsPrevMonth.diff ?? 0)} respecto al mes anterior
            </p>
          ) : (
            <p className="text-xs text-disabled italic mt-1">Sin historial suficiente para tendencia</p>
          )}
        </div>
      </div>

      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5">Desglose de contribución</p>
      <div className="space-y-1 mb-3">
        {data.factors.filter((f) => f.points > 0).length === 0 ? (
          <p className="text-xs text-disabled">Sin factores de riesgo activos</p>
        ) : (
          data.factors
            .filter((f) => f.points > 0)
            .sort((a, b) => b.points - a.points)
            .map((f) => (
              <div key={f.name} className="flex items-center justify-between text-xs">
                <span className="text-secondary">+{f.points} {f.name}</span>
                <span className="text-disabled text-right ml-2">{f.detail}</span>
              </div>
            ))
        )}
      </div>

      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1.5 pt-2 border-t border-border">Acciones sugeridas</p>
      <ul className="space-y-1 mb-3">
        {data.suggestedActions.map((a, i) => (
          <li key={i} className="text-xs text-title flex gap-1.5">
            <span className="text-primary shrink-0">→</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>

      <div className="pt-2 border-t border-border">
        <ConfidenceBadges {...data.confidence} compact />
      </div>

      {explainOpen && (
        <ExplainModal
          title="Índice de Riesgo Operativo"
          formula={data.explain.formula}
          steps={data.explain.steps}
          factors={data.factors.map((f) => ({
            name: f.name,
            rawLabel: f.detail,
            normalizedValue: f.weight > 0 ? Math.round((f.points / f.weight) * 100 * 10) / 10 : 0,
            weight: f.weight,
            points: f.points,
          }))}
          dataUsed={data.factors.map((f) => `${f.name}: ${f.detail}`)}
          resultValue={Math.round(data.score)}
          resultInterpretation={`Riesgo ${data.classification}`}
          engineVersion={data.engineVersion}
          lastUpdated={data.lastUpdated}
          dataSource="Capacidad proyectada, tendencias de cumplimiento, consistencia semanal, horas de fin de semana y tareas vencidas del mes en curso"
          referenceUsed="Clasificación por umbrales configurados en Ajustes: Bajo / Medio / Alto / Crítico"
          confidence={data.confidence}
          onClose={() => setExplainOpen(false)}
        />
      )}
    </div>
  );
}

// ── Vista de equipo (resumen para gerencia) ─────────────────────────────────

type TeamMember = OperationalRiskResult & { id: string; name: string; role: string };
type TeamResponse = { members: TeamMember[]; summary: { bajo: number; medio: number; alto: number; critico: number }; engineVersion: string; lastUpdated: string };

const DOT_CLASS: Record<string, string> = { Bajo: "bg-success", Medio: "bg-warning", Alto: "bg-orange-500", Crítico: "bg-danger" };

export function TeamOperationalRiskCard({ currentUserRole }: { currentUserRole: Role }) {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const canView = canViewOperationalRisk(currentUserRole) && isFeatureEnabled("enableOperationalRisk");

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/analytics/operational-risk/team");
      if (res.ok) {
        const json: TeamResponse = await res.json();
        if (!cancelled) setData(json);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canView]);

  if (!canView) return null;
  if (loading || !data) {
    return (
      <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5 flex justify-center py-8">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Índice de Riesgo Operativo del equipo</h3>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] mb-3">
        <span className="text-success font-medium">🟢 {data.summary.bajo} bajo</span>
        <span className="text-warning font-medium">🟡 {data.summary.medio} medio</span>
        <span className="text-orange-500 font-medium">🟠 {data.summary.alto} alto</span>
        <span className="text-danger font-medium">🔴 {data.summary.critico} crítico</span>
      </div>
      {data.members.length === 0 ? (
        <p className="text-sm text-disabled py-4 text-center">Sin colaboradores para mostrar</p>
      ) : (
        <div className="space-y-1.5">
          {data.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[m.classification]}`} />
              <span className="text-sm text-title flex-1 truncate">{m.name}</span>
              <span className={`text-xs font-semibold ${CLASS_TEXT[m.classification]}`}>{m.classification}</span>
              <span className="text-sm font-bold text-main w-10 text-right">{Math.round(m.score)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
