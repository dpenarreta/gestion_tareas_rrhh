"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { ExecutiveDashboardData, KpiColor, CapacityMember, CapacitySummary } from "./types";
import { CumplimientoLineChart, TeamWorkloadBarChart } from "./KpiCharts";
import { hoursToDisplay } from "@/lib/timeFormat";
import { isFeatureEnabled } from "@/lib/featureFlags";

type TeamRiskMember = { id: string; name: string; role: string; score: number; classification: "Bajo" | "Medio" | "Alto" | "Crítico"; suggestedActions: string[] };
type TeamRiskResponse = { members: TeamRiskMember[]; summary: { bajo: number; medio: number; alto: number; critico: number } };

/**
 * Modo Ejecutivo (§16) — vista condensada: score general, riesgo del equipo,
 * alertas críticas, tendencias, sobrecargados/con capacidad, recomendaciones
 * prioritarias. Máximo 2 minutos de lectura — sin tablas de detalle ni drill down.
 */
function ExecutiveModeView({ data }: { data: ExecutiveDashboardData }) {
  const [teamRisk, setTeamRisk] = useState<TeamRiskResponse | null>(null);
  const [capacity, setCapacity] = useState<{ members: CapacityMember[]; summary: CapacitySummary } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [riskRes, capRes] = await Promise.all([
        fetch("/api/analytics/operational-risk/team"),
        fetch("/api/kpis/team-capacity"),
      ]);
      if (!cancelled) {
        if (riskRes.ok) setTeamRisk(await riskRes.json());
        if (capRes.ok) setCapacity(await capRes.json());
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const avgScore = data.ranking.length > 0 ? Math.round(data.ranking.reduce((s, m) => s + m.score, 0) / data.ranking.length) : 0;
  const avgRiskScore = teamRisk && teamRisk.members.length > 0 ? Math.round(teamRisk.members.reduce((s, m) => s + m.score, 0) / teamRisk.members.length) : null;
  const overloaded = data.ranking.filter((m) => m.cargaColor === "red" || m.cargaColor === "orange");
  const available = capacity?.members.filter((m) => m.estado === "alta") ?? [];
  const priorityActions = teamRisk
    ? [...teamRisk.members]
        .filter((m) => m.classification === "Alto" || m.classification === "Crítico")
        .sort((a, b) => b.score - a.score)
        .flatMap((m) => m.suggestedActions.filter((a) => !a.startsWith("Sin acciones")).map((a) => `${m.name}: ${a}`))
        .slice(0, 3)
    : [];

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <p className="text-xs font-medium text-secondary mb-1">Score general del área</p>
          <p className="text-4xl font-bold text-title">{avgScore}<span className="text-lg text-disabled">/100</span></p>
        </div>
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <p className="text-xs font-medium text-secondary mb-1">Índice de Riesgo Operativo del equipo</p>
          {avgRiskScore !== null ? (
            <p className="text-4xl font-bold text-title">{avgRiskScore}<span className="text-lg text-disabled">/100</span></p>
          ) : (
            <p className="text-sm text-disabled italic">Sin datos</p>
          )}
          {teamRisk && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] mt-1.5">
              <span className="text-success">🟢 {teamRisk.summary.bajo}</span>
              <span className="text-warning">🟡 {teamRisk.summary.medio}</span>
              <span className="text-orange-500">🟠 {teamRisk.summary.alto}</span>
              <span className="text-danger">🔴 {teamRisk.summary.critico}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[14px] border border-danger/30 bg-danger/[.05] p-5">
        <h3 className="text-sm font-semibold text-danger uppercase tracking-wider mb-3">Alertas críticas activas</h3>
        {data.alerts.lowCumplimiento.length === 0 && data.alerts.sobrecarga.length === 0 ? (
          <p className="text-sm text-disabled">Sin alertas críticas este mes</p>
        ) : (
          <div className="flex flex-wrap gap-4 text-sm">
            {data.alerts.lowCumplimiento.length > 0 && <span className="text-danger font-medium">{data.alerts.lowCumplimiento.length} con cumplimiento &lt; 60%</span>}
            {data.alerts.sobrecarga.length > 0 && <span className="text-danger font-medium">{data.alerts.sobrecarga.length} en sobrecarga</span>}
          </div>
        )}
      </div>

      <div className="rounded-[14px] border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Tendencia clave</h3>
        <p className={`text-lg font-bold flex items-center gap-2 ${data.trendDelta > 0 ? "text-success" : data.trendDelta < 0 ? "text-danger" : "text-disabled"}`}>
          {data.trendDelta > 0 ? "▲" : data.trendDelta < 0 ? "▼" : "="} Cumplimiento {Math.abs(data.trendDelta)}pp vs. mes anterior
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Personas sobrecargadas</h3>
          {overloaded.length === 0 ? (
            <p className="text-sm text-success">Nadie en sobrecarga</p>
          ) : (
            <ul className="space-y-1">
              {overloaded.map((m) => <li key={m.id} className="text-sm text-title">{m.name}</li>)}
            </ul>
          )}
        </div>
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-2">Con capacidad disponible</h3>
          {available.length === 0 ? (
            <p className="text-sm text-disabled">Nadie con capacidad alta este mes</p>
          ) : (
            <ul className="space-y-1">
              {available.map((m) => <li key={m.id} className="text-sm text-title">{m.name}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-[14px] p-5 bg-nova-soft">
        <h3 className="text-[13px] font-semibold text-nova mb-2">Recomendaciones prioritarias</h3>
        {priorityActions.length === 0 ? (
          <p className="text-sm text-title">Sin riesgos altos/críticos detectados este mes.</p>
        ) : (
          <ul className="space-y-1.5">
            {priorityActions.map((a, i) => (
              <li key={i} className="text-sm text-title flex gap-2">
                <span className="text-nova shrink-0">⚡</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const DOT_CLASS: Record<KpiColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-danger",
};

const CARD_BG: Record<KpiColor, string> = {
  green: "bg-success/[.13] border-transparent",
  yellow: "bg-warning/[.15] border-transparent",
  red: "bg-danger/[.13] border-transparent",
};

const CARD_VALUE: Record<KpiColor, string> = {
  green: "text-success",
  yellow: "text-warning",
  red: "text-danger",
};

const WORKLOAD_DOT: Record<string, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  orange: "bg-orange-500",
  red: "bg-danger",
};

function OverviewCard({
  title,
  value,
  unit,
  color,
  icon,
}: {
  title: string;
  value: number;
  unit?: string;
  color: KpiColor | "gray";
  icon: React.ReactNode;
}) {
  const bg = color === "gray" ? "bg-background border-border" : CARD_BG[color];
  const valueColor = color === "gray" ? "text-main" : CARD_VALUE[color];
  return (
    <div className={`rounded-[14px] border p-5 ${bg}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-surface rounded-xl shadow-sm">{icon}</div>
        {color !== "gray" && <span className={`w-2.5 h-2.5 rounded-full mt-1 ${DOT_CLASS[color]}`} />}
      </div>
      <p className="text-xs font-medium text-secondary mb-1">{title}</p>
      <p className={`text-3xl font-bold ${valueColor}`}>
        {value}
        {unit && <span className="text-lg ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const IdeaStatusLabel: Record<string, string> = {
  PROPUESTA: "Propuesta",
  EN_REVISION: "En revisión",
};

const ESTADO_EMOJI: Record<KpiColor, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const RISK_EMOJI: Record<string, string> = { green: "🟢", yellow: "🟡", orange: "🟠", red: "🔴" };

/** Resumen ejecutivo determinístico en cabecera — solo Administrador/Jefe Nacional/Coordinador Nacional (ver Sprint 2 § S2-A, ampliado en Sprint 5 § S5-K). */
function CeoBlock({ ceo }: { ceo: ExecutiveDashboardData["ceo"] }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Resumen ejecutivo</h3>
        <span className="text-sm font-semibold text-title flex items-center gap-1.5">
          {ESTADO_EMOJI[ceo.estado]} {ceo.estadoLabel}
        </span>
      </div>

      {/* Dos índices separados — nunca mezclados en un solo número (§Sprint 5 S5-K). */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-border bg-background p-3">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Performance</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-title">{ceo.performance.avg}</span>
            <span className="text-xs font-semibold flex items-center gap-1">{ESTADO_EMOJI[ceo.performance.color]} {ceo.performance.classification}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background p-3">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Operational Risk</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-title">{ceo.operationalRisk.avg}</span>
            <span className="text-xs font-semibold flex items-center gap-1">{RISK_EMOJI[ceo.operationalRisk.color]} {ceo.operationalRisk.classification}</span>
          </div>
        </div>
      </div>

      {ceo.cambios.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Cambios desde el último cálculo</p>
          <ul className="space-y-1">
            {ceo.cambios.map((c, i) => (
              <li key={i} className={`text-sm flex items-start gap-2 ${c.positive ? "text-success" : "text-warning"}`}>
                <span className="shrink-0">{c.positive ? "✔" : "⚠"}</span>
                <span className="text-title">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ceo.atender.length > 0 ? (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Hoy debes atender</p>
          <ol className="space-y-1">
            {ceo.atender.map((text, i) => (
              <li key={i} className="text-sm text-title flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">{["①", "②", "③"][i] ?? `${i + 1}.`}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-success mb-3">Sin puntos críticos que atender hoy 🎉</p>
      )}

      <a href="#detalle-completo" className="text-xs font-medium text-primary hover:text-primary-hover">
        Ver detalle completo ↓
      </a>
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [data, setData] = useState<ExecutiveDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [modoEjecutivo, setModoEjecutivo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch("/api/kpis/executive");
        if (!res.ok) throw new Error("failed");
        const json: ExecutiveDashboardData = await res.json();
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
  }, []);

  // Sprint D (Bloque 2): antes se reconstruía este array literal en cada
  // render dentro del JSX, invalidando cualquier memoización del propio
  // gráfico (prop identity nueva siempre).
  const trendChartData = useMemo(
    () => (data?.trend ?? []).map((t) => ({ month: t.month, label: t.label, completedPct: t.avgCumplimiento })),
    [data]
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center py-32">
        <Spinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-disabled text-sm">
        Error al cargar el resumen ejecutivo. Intenta de nuevo.
      </div>
    );
  }

  if (data.ranking.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-disabled">
        <svg className="w-12 h-12 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-sm">No hay colaboradores para mostrar en el resumen ejecutivo</p>
      </div>
    );
  }

  const totalAlerts = data.alerts.lowCumplimiento.length + data.alerts.sobrecarga.length + data.alerts.pendingIdeas.length;
  const executiveModeEnabled = isFeatureEnabled("enableExecutiveMode");

  const modeToggle = executiveModeEnabled && (
    <div className="flex items-center justify-end">
      <button
        onClick={() => setModoEjecutivo((v) => !v)}
        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${
          modoEjecutivo ? "bg-primary text-white" : "bg-surface2 text-secondary hover:text-title"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Modo Ejecutivo
      </button>
    </div>
  );

  if (executiveModeEnabled && modoEjecutivo) {
    return (
      <div className="flex flex-col gap-5">
        {isFeatureEnabled("enableExecutiveSummary") && <CeoBlock ceo={data.ceo} />}
        {modeToggle}
        <div id="detalle-completo">
          <ExecutiveModeView data={data} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {isFeatureEnabled("enableExecutiveSummary") && <CeoBlock ceo={data.ceo} />}
      {modeToggle}

      {/* ── Overview cards ─────────────────────────────────────────────── */}
      <div id="detalle-completo" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <OverviewCard
          title="Cumplimiento del equipo"
          value={data.overview.avgCumplimiento}
          unit="%"
          color={data.overview.avgCumplimientoColor}
          icon={
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <OverviewCard
          title="En sobrecarga"
          value={data.overview.sobrecargaCount}
          color={data.overview.sobrecargaCount > 0 ? "red" : "green"}
          icon={
            <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          }
        />
        <OverviewCard
          title="En subutilización"
          value={data.overview.subutilizacionCount}
          color={data.overview.subutilizacionCount > 0 ? "red" : "green"}
          icon={
            <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 12h-15" />
            </svg>
          }
        />
        <OverviewCard
          title="Horas del equipo este mes"
          value={Math.round(data.overview.totalHoras)}
          unit="h"
          color="gray"
          icon={
            <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <OverviewCard
          title="Consultas SEGUIMIENTO"
          value={data.overview.totalConsultas}
          color="gray"
          icon={
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Trend ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Section
            title="Cumplimiento del equipo — últimos 6 meses"
            action={
              <span
                className={`flex items-center gap-1 text-xs font-semibold ${
                  data.trendDelta > 0 ? "text-success" : data.trendDelta < 0 ? "text-danger" : "text-disabled"
                }`}
              >
                {data.trendDelta > 0 ? "▲" : data.trendDelta < 0 ? "▼" : "="} {Math.abs(data.trendDelta)} pp vs mes anterior
              </span>
            }
          >
            <CumplimientoLineChart data={trendChartData} />
          </Section>
        </div>

        {/* ── Alerts ───────────────────────────────────────────────────── */}
        <div className="rounded-[14px] border border-danger/30 bg-danger/[.05] shadow-[var(--shadow)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-danger uppercase tracking-wider">Alertas críticas</h3>
            <span className="text-xs font-bold text-danger bg-danger/[.15] px-2 py-0.5 rounded-full">{totalAlerts}</span>
          </div>

          {totalAlerts === 0 ? (
            <p className="text-sm text-disabled py-4 text-center">Sin alertas este mes 🎉</p>
          ) : (
            <div className="space-y-4">
              {data.alerts.lowCumplimiento.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5">
                    Cumplimiento &lt; 60%
                  </p>
                  <ul className="space-y-1">
                    {data.alerts.lowCumplimiento.map((a) => (
                      <li key={a.userId} className="flex items-center justify-between text-sm">
                        <span className="text-title truncate">{a.name}</span>
                        <span className="text-danger font-semibold shrink-0 ml-2">{a.value}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.alerts.sobrecarga.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5">Sobrecarga</p>
                  <ul className="space-y-1">
                    {data.alerts.sobrecarga.map((a) => (
                      <li key={a.userId} className="flex items-center justify-between text-sm">
                        <span className="text-title truncate">{a.name}</span>
                        <span className="text-danger font-semibold shrink-0 ml-2">{a.value}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.alerts.pendingIdeas.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5">
                    Ideas pendientes de revisión
                  </p>
                  <ul className="space-y-1">
                    {data.alerts.pendingIdeas.map((idea) => (
                      <li key={idea.id} className="text-sm">
                        <span className="text-title truncate">{idea.title}</span>
                        <span className="text-disabled">
                          {" "}
                          — {IdeaStatusLabel[idea.status] ?? idea.status} · {idea.authorName}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Ranking ──────────────────────────────────────────────────────── */}
      <Section title={`Ranking del equipo (${data.ranking.length})`}>
        <div className="space-y-1">
          {data.ranking.map((m, i) => (
            <div
              key={m.id}
              className="flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-b border-border last:border-0"
            >
              <span className="text-xs font-bold text-disabled w-5 shrink-0">{i + 1}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${WORKLOAD_DOT[m.cargaColor]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-title truncate">{m.name}</p>
                <p className="text-[11px] text-secondary truncate">{ROLE_LABEL[m.role as Role] ?? m.role}</p>
              </div>
              <span className="text-xs text-secondary shrink-0 hidden sm:inline">{m.completedPct}% cumpl.</span>
              <span
                className={`text-xs font-semibold shrink-0 w-14 text-right ${
                  m.scoreTrend > 0 ? "text-success" : m.scoreTrend < 0 ? "text-danger" : "text-disabled"
                }`}
              >
                {m.scoreTrend > 0 ? "▲" : m.scoreTrend < 0 ? "▼" : "="} {Math.abs(m.scoreTrend)}
              </span>
              <span className="text-sm font-bold text-main shrink-0 w-12 text-right">{m.score}/100</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Team workload chart ─────────────────────────────────────────── */}
      <Section title="Carga laboral del equipo este mes">
        <TeamWorkloadBarChart data={data.workload} />
        <p className="text-[10px] text-disabled mt-2">
          Base esperada según horas efectivas configuradas; horas reales coloreadas según el semáforo de cada persona
          {data.workload.length > 0 && ` — total ${hoursToDisplay(data.workload.reduce((s, w) => s + w.realHours, 0))}h reales`}.
        </p>
      </Section>
    </div>
  );
}
