"use client";

import { useState, useEffect } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { KpiData, KpiColor } from "./types";
import {
  DonutChart,
  WeeklyHoursChart,
  CumplimientoLineChart,
  REASON_LABEL,
} from "./KpiCharts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  });
}

const DOT_CLASS: Record<KpiColor, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

const CARD_BG: Record<KpiColor | "gray", string> = {
  green: "bg-green-50 border-green-200",
  yellow: "bg-amber-50 border-amber-200",
  red: "bg-red-50 border-red-200",
  gray: "bg-slate-50 border-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
  CANCELADA: "Cancelada",
};

const STATUS_BADGE: Record<string, string> = {
  PENDIENTE: "bg-slate-100 text-slate-600",
  EN_PROGRESO: "bg-blue-100 text-blue-700",
  COMPLETADA: "bg-green-100 text-green-700",
  CANCELADA: "bg-slate-100 text-slate-400 line-through",
};

const TYPE_LABEL: Record<string, string> = {
  SEGUIMIENTO: "Seguimiento",
  ADMINISTRATIVO: "Administrativo",
  OPERATIVO: "Operativo",
  PROYECTO: "Proyecto",
  REUNION: "Reunión",
  CAPACITACION: "Capacitación",
};

function DeltaBadge({ current, prev, suffix = "%" }: { current: number; prev: number; suffix?: string }) {
  if (prev === 0 && current === 0) return null;
  const delta = current - prev;
  if (delta === 0) return <span className="text-[11px] text-slate-400">sin cambio</span>;
  const positive = delta > 0;
  return (
    <span className={`text-[11px] font-medium ${positive ? "text-green-600" : "text-red-500"}`}>
      {positive ? "▲" : "▼"} {Math.abs(delta)}{suffix} vs mes anterior
    </span>
  );
}

function motivationalMessage(pct: number, tasks: number): { icon: string; text: string; bg: string } {
  if (tasks === 0) {
    return {
      icon: "📋",
      text: "No tienes tareas asignadas este mes. Consulta con tu coordinador si hay actividades pendientes de registrar.",
      bg: "bg-slate-50 border-slate-200",
    };
  }
  if (pct >= 90) {
    return {
      icon: "🌟",
      text: "Desempeño sobresaliente. Mantener este nivel de cumplimiento tiene un impacto directo en los resultados del equipo.",
      bg: "bg-green-50 border-green-200",
    };
  }
  if (pct >= 80) {
    return {
      icon: "✅",
      text: "Buen mes. Estás cumpliendo con el objetivo y contribuyendo al desempeño general. Sigue así.",
      bg: "bg-green-50 border-green-200",
    };
  }
  if (pct >= 60) {
    return {
      icon: "📈",
      text: "Estás dentro del rango aceptable, aunque hay tareas pendientes que pueden afectar el resultado final. Prioriza las que están próximas a vencer.",
      bg: "bg-amber-50 border-amber-200",
    };
  }
  return {
    icon: "⚠️",
    text: "Este mes presenta un cumplimiento bajo. Revisa las tareas vencidas y coordina con tu supervisor si necesitas apoyo o redistribución de carga.",
    bg: "bg-red-50 border-red-200",
  };
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-indigo-600" : "text-slate-800"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { currentUserName: string; currentUserRole: string };

export default function MyKpisModule({ currentUserName, currentUserRole }: Props) {
  const [month, setMonth] = useState(currentMonthParam);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/kpis/me?month=${month}`)
      .then((r) => r.json())
      .then((data: KpiData | { error: string }) => {
        if ("error" in data) { setError(data.error); setKpi(null); }
        else setKpi(data);
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mis KPIs</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {currentUserName} — {ROLE_LABEL[currentUserRole as Role] ?? currentUserRole}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 w-fit">
          <label className="text-sm text-slate-500 whitespace-nowrap">Mes:</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-32">
          <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && kpi && (
        <div className="space-y-5">
          {/* Period label */}
          <p className="text-sm font-medium text-slate-500">
            Período: <span className="text-slate-800">{formatMonthLabel(month)}</span>
          </p>

          {/* Score + Donuts row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Score */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col items-center justify-center gap-2">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Score global</p>
              <div className="relative w-28 h-28 flex items-center justify-center">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke={kpi.score >= 80 ? "#22c55e" : kpi.score >= 60 ? "#f59e0b" : "#ef4444"}
                    strokeWidth="10"
                    strokeDasharray={`${(kpi.score / 100) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute text-3xl font-bold text-slate-800">{kpi.score}</span>
              </div>
              <p className="text-xs text-slate-400">/ 100 puntos</p>
              {kpi.prevMonth && (
                <DeltaBadge current={kpi.score} prev={Math.round(
                  ((kpi.prevMonth.completedPct / 100) * 40) +
                  Math.max(0, 20 - Math.max(0, kpi.prevMonth.cargaRatio - 100) * 0.5)
                )} suffix=" pts" />
              )}
            </div>

            {/* Cumplimiento donut */}
            <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 ${CARD_BG[kpi.cumplimiento.color]}`}>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium self-start">Cumplimiento</p>
              <DonutChart
                pct={kpi.cumplimiento.completedPct}
                color={kpi.cumplimiento.color}
                label={`${kpi.cumplimiento.completedPct}%`}
                sublabel={`${kpi.cumplimiento.completed}/${kpi.cumplimiento.total} tareas`}
              />
              <div className="w-full space-y-1 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Vencidas</span>
                  <span className={kpi.cumplimiento.overdue > 0 ? "text-red-600 font-semibold" : "text-slate-400"}>
                    {kpi.cumplimiento.overdue}
                    {kpi.cumplimiento.overdue > 0 && kpi.cumplimiento.avgDelayDays > 0
                      ? ` (${kpi.cumplimiento.avgDelayDays}d prom.)`
                      : ""}
                  </span>
                </div>
              </div>
              {kpi.prevMonth && (
                <DeltaBadge current={kpi.cumplimiento.completedPct} prev={kpi.prevMonth.completedPct} />
              )}
            </div>

            {/* Carga laboral donut */}
            <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 ${CARD_BG[kpi.cargaLaboral.color]}`}>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium self-start">Carga laboral</p>
              <DonutChart
                pct={Math.min(kpi.cargaLaboral.ratio, 200)}
                color={kpi.cargaLaboral.color}
                label={`${kpi.cargaLaboral.ratio}%`}
                sublabel={`${kpi.cargaLaboral.realHours}h / ${kpi.cargaLaboral.estimatedHours}h est.`}
              />
              {kpi.prevMonth && (
                <DeltaBadge current={kpi.cargaLaboral.ratio} prev={kpi.prevMonth.cargaRatio} />
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total tareas" value={kpi.cumplimiento.total} sub={formatMonthLabel(month)} />
            <StatCard
              label="Completadas"
              value={kpi.cumplimiento.completed}
              sub={`${kpi.cumplimiento.completedPct}% del total`}
              accent
            />
            <StatCard
              label="Vencidas"
              value={kpi.cumplimiento.overdue}
              sub={kpi.cumplimiento.overdue > 0 ? `Prom. ${kpi.cumplimiento.avgDelayDays}d retraso` : "Sin retrasos"}
            />
            <StatCard
              label="Consultas SEGUIMIENTO"
              value={kpi.seguimiento.total}
              sub={`${kpi.seguimiento.byReason.length} motivos distintos`}
            />
          </div>

          {/* Motivational message */}
          {(() => {
            const msg = motivationalMessage(kpi.cumplimiento.completedPct, kpi.cumplimiento.total);
            return (
              <div className={`rounded-2xl border px-5 py-4 flex items-start gap-3 ${msg.bg}`}>
                <span className="text-2xl leading-none mt-0.5">{msg.icon}</span>
                <p className="text-sm text-slate-700 leading-relaxed">{msg.text}</p>
              </div>
            );
          })()}

          {/* Charts row */}
          {(kpi.horasByWeek.length > 0 || kpi.cumplimientoHistory.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {kpi.horasByWeek.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <p className="text-sm font-semibold text-slate-700 uppercase tracking-wider text-[11px] mb-4">
                    Horas por semana
                  </p>
                  <WeeklyHoursChart data={kpi.horasByWeek} />
                </div>
              )}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-4">
                  Evolución cumplimiento (6 meses)
                </p>
                <CumplimientoLineChart data={kpi.cumplimientoHistory} />
              </div>
            </div>
          )}

          {/* Seguimiento by reason */}
          {kpi.seguimiento.byReason.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-4">
                Consultas SEGUIMIENTO por motivo
              </h3>
              <div className="space-y-2">
                {kpi.seguimiento.byReason
                  .sort((a, b) => b.count - a.count)
                  .map((r) => {
                    const maxCount = Math.max(...kpi.seguimiento.byReason.map((x) => x.count));
                    const pct = Math.round((r.count / maxCount) * 100);
                    return (
                      <div key={r.reason} className="flex items-center gap-3">
                        <span className="text-xs text-slate-600 w-44 shrink-0 truncate" title={REASON_LABEL[r.reason] ?? r.reason}>
                          {REASON_LABEL[r.reason] ?? r.reason}
                        </span>
                        <div className="flex-1 bg-slate-100 rounded-full h-2">
                          <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-700 w-6 text-right">{r.count}</span>
                        <span className="text-[11px] text-slate-400 w-20 text-right">{r.totalMinutes} min total</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Calidad y actividad */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1">Progreso prom.</p>
              <p className="text-2xl font-bold text-slate-800">{kpi.calidad.avgProgress}%</p>
              <p className="text-xs text-slate-400 mt-0.5">tareas en progreso</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1">Tareas recurrentes</p>
              <p className="text-2xl font-bold text-slate-800">{kpi.calidad.recurringPct}%</p>
              <p className="text-xs text-slate-400 mt-0.5">{kpi.calidad.recurringCompleted}/{kpi.calidad.recurringTotal} completadas</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1">Asignadas por otros</p>
              <p className="text-2xl font-bold text-slate-800">{kpi.actividad.assignedByOthers}</p>
              <p className="text-xs text-slate-400 mt-0.5">de {kpi.cumplimiento.total} tareas</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1">Comentarios</p>
              <p className="text-2xl font-bold text-slate-800">{kpi.actividad.totalComments}</p>
              <p className="text-xs text-slate-400 mt-0.5">registrados en el período</p>
            </div>
          </div>

          {/* Task detail table */}
          {kpi.tasks.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-4">
                Mis tareas — {formatMonthLabel(month)}
              </h3>
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm min-w-[580px]">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["Tarea", "Tipo", "Estado", "Vence", "Retraso"].map((h) => (
                        <th key={h} className="text-left py-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kpi.tasks
                      .sort((a, b) => {
                        const order = { red: 0, yellow: 1, green: 2 } as Record<KpiColor, number>;
                        return order[a.color] - order[b.color];
                      })
                      .map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[t.color]}`} />
                              <span className="text-sm text-slate-800 leading-snug">{t.title}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              {TYPE_LABEL[t.type] ?? t.type}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[t.status] ?? "bg-slate-100 text-slate-500"}`}>
                              {STATUS_LABEL[t.status] ?? t.status}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-slate-500">
                            {new Date(t.endDate).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
                          </td>
                          <td className="py-2.5 pr-4">
                            {t.delayDays > 0 ? (
                              <span className="text-xs text-red-600 font-medium">{t.delayDays}d</span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {kpi.tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">Sin tareas asignadas en este período</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
