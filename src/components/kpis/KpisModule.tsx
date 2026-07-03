"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { KpiData, KpiColor, TeamMemberKpi } from "./types";
import {
  DonutChart,
  WeeklyHoursChart,
  CumplimientoLineChart,
  ConsultasBarChart,
  REASON_LABEL,
} from "./KpiCharts";
import MonthlyReports from "./MonthlyReports";
import * as XLSX from "xlsx";
import { formatDate } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-indigo-500",
  "from-violet-500 to-purple-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
];

function avatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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

// ── Traffic light helpers ────────────────────────────────────────────────────

const DOT_CLASS: Record<KpiColor, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

const COLOR_RING: Record<KpiColor, string> = {
  green: "ring-green-200",
  yellow: "ring-amber-200",
  red: "ring-red-200",
};

const CARD_BG: Record<KpiColor | "gray", string> = {
  green: "bg-green-50 border-green-200",
  yellow: "bg-amber-50 border-amber-200",
  red: "bg-red-50 border-red-200",
  gray: "bg-background border-border",
};

const CARD_VALUE: Record<KpiColor | "gray", string> = {
  green: "text-green-700",
  yellow: "text-amber-700",
  red: "text-red-700",
  gray: "text-main",
};

// ── Status labels ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
};

const STATUS_STYLE: Record<string, string> = {
  PENDIENTE: "bg-slate-100 text-slate-700",
  EN_PROGRESO: "bg-blue-100 text-blue-700",
  COMPLETADA: "bg-green-100 text-green-700",
};

const TYPE_LABEL: Record<string, string> = {
  FIJA: "Fija",
  SEGUIMIENTO: "Seguimiento",
};

// ── SummaryCard ───────────────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  unit,
  color,
  delta,
  invertDelta,
  icon,
}: {
  title: string;
  value: number;
  unit?: string;
  color: KpiColor | "gray";
  delta: number;
  invertDelta?: boolean;
  icon: React.ReactNode;
}) {
  const deltaPositive = invertDelta ? delta < 0 : delta > 0;
  const deltaColor = delta === 0 ? "text-disabled" : deltaPositive ? "text-green-600" : "text-red-500";

  return (
    <div className={`rounded-2xl border p-5 ${CARD_BG[color]}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-surface rounded-xl shadow-sm">{icon}</div>
        <div className={`w-2.5 h-2.5 rounded-full mt-1 ${DOT_CLASS[color === "gray" ? "green" : color]}`} />
      </div>
      <p className="text-xs font-medium text-secondary mb-1">{title}</p>
      <p className={`text-3xl font-bold ${CARD_VALUE[color]}`}>
        {value}
        {unit && <span className="text-lg ml-0.5">{unit}</span>}
      </p>
      <p className={`text-xs mt-1 ${deltaColor}`}>
        {delta > 0 ? "▲" : delta < 0 ? "▼" : "="}{" "}
        {Math.abs(delta)}
        {unit} vs mes anterior
      </p>
    </div>
  );
}

// ── SubordinateCard ───────────────────────────────────────────────────────────

function SubordinateCard({
  member,
  selected,
  onClick,
}: {
  member: TeamMemberKpi;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3 group ${
        selected
          ? "bg-primary-surface ring-2 ring-primary/40"
          : "hover:bg-black/5 dark:hover:bg-white/5 ring-1 ring-transparent"
      }`}
    >
      <div
        className={`w-9 h-9 rounded-lg bg-gradient-to-br ${avatarGradient(member.name)} flex items-center justify-center shrink-0`}
      >
        <span className="text-xs font-bold text-white">{initials(member.name)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-semibold truncate ${selected ? "text-primary" : "text-title"}`}
        >
          {member.name}
        </p>
        <p className="text-[10px] text-secondary truncate">{ROLE_LABEL[member.role as Role]}</p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-sm font-bold text-main">{member.score}</span>
        <div className={`w-2 h-2 rounded-full ${DOT_CLASS[member.color]}`} />
      </div>
    </button>
  );
}

// ── MetricRow ─────────────────────────────────────────────────────────────────

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-main">{label}</span>
      <span className="text-sm font-semibold text-title">{value}</span>
    </div>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────────

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Excel export ──────────────────────────────────────────────────────────────

function downloadExcel(kpi: KpiData) {
  const wb = XLSX.utils.book_new();

  const summaryData = [
    ["Reporte KPI", ""],
    ["Colaborador", kpi.user.name],
    ["Rol", ROLE_LABEL[kpi.user.role as Role]],
    ["Período", formatMonthLabel(kpi.period.month)],
    ["Score global /100", `${kpi.score}/100`],
    [""],
    ["CUMPLIMIENTO", ""],
    ["% Tareas completadas", `${kpi.cumplimiento.completedPct}%`],
    ["Total tareas", kpi.cumplimiento.total],
    ["Completadas", kpi.cumplimiento.completed],
    ["Vencidas sin completar", kpi.cumplimiento.overdue],
    ["Días promedio de retraso", kpi.cumplimiento.avgDelayDays],
    [""],
    ["CARGA LABORAL", ""],
    ["Horas estimadas", kpi.cargaLaboral.estimatedHours],
    ["Horas reales", kpi.cargaLaboral.realHours],
    ["Carga laboral %", `${kpi.cargaLaboral.ratio}%`],
    ["Nota", "Horas sobre el estimado pueden indicar exceso de carga laboral, no incumplimiento"],
    [""],
    ["CALIDAD", ""],
    ["Avance promedio (EN_PROGRESO)", `${kpi.calidad.avgProgress}%`],
    ["Tareas recurrentes completadas", `${kpi.calidad.recurringCompleted}/${kpi.calidad.recurringTotal}`],
    [""],
    ["ACTIVIDAD", ""],
    ["Comentarios registrados", kpi.actividad.totalComments],
    ["Tareas asignadas por superior", kpi.actividad.assignedByOthers],
    ["Tareas propias", kpi.actividad.ownTasks],
    [""],
    ["SEGUIMIENTO", ""],
    ["Total consultas atendidas", kpi.seguimiento.total],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, ws1, "Resumen");

  const tasksData = [
    ["Título", "Tipo", "Estado", "Fecha fin", "Días retraso", "Semáforo"],
    ...kpi.tasks.map((t) => [
      t.title,
      TYPE_LABEL[t.type] ?? t.type,
      STATUS_LABEL[t.status] ?? t.status,
      new Date(t.endDate).toLocaleDateString("es-CL"),
      t.delayDays,
      t.color === "green" ? "Verde" : t.color === "yellow" ? "Amarillo" : "Rojo",
    ]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(tasksData);
  XLSX.utils.book_append_sheet(wb, ws2, "Tareas");

  if (kpi.seguimiento.byReason.length > 0) {
    const reasonData = [
      ["Motivo", "Consultas", "Total minutos", "Promedio minutos"],
      ...kpi.seguimiento.byReason.map((r) => [
        REASON_LABEL[r.reason] ?? r.reason,
        r.count,
        r.totalMinutes,
        r.avgMinutes,
      ]),
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(reasonData);
    XLSX.utils.book_append_sheet(wb, ws3, "Consultas");
  }

  XLSX.writeFile(wb, `KPI_${kpi.user.name.replace(/\s+/g, "_")}_${kpi.period.month}.xlsx`);
}

// ── PDF export ────────────────────────────────────────────────────────────────

function downloadPDF(kpi: KpiData) {
  const colorEmoji = (c: KpiColor) => (c === "green" ? "🟢" : c === "yellow" ? "🟡" : "🔴");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>KPI – ${kpi.user.name} – ${kpi.period.month}</title>
<style>
  body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;max-width:800px;margin:0 auto}
  h1{color:#4f46e5;margin-bottom:4px}
  h2{margin-top:28px;margin-bottom:8px;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
  .meta{color:#64748b;font-size:13px;margin-bottom:20px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}
  .card{border:1px solid #e2e8f0;border-radius:10px;padding:16px}
  .card-title{font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:.06em}
  .card-value{font-size:28px;font-weight:700;margin:4px 0}
  .score{font-size:40px;font-weight:800;color:#4f46e5}
  .note{font-size:11px;color:#94a3b8;font-style:italic;margin-top:6px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  th{background:#f8fafc;text-align:left;padding:8px 10px;border:1px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
  td{padding:8px 10px;border:1px solid #e2e8f0;vertical-align:middle}
  tr:nth-child(even) td{background:#fafafa}
  @media print{body{padding:16px}}
</style>
</head>
<body>
  <h1>Reporte KPI</h1>
  <div class="meta">
    <strong>${kpi.user.name}</strong> &bull; ${ROLE_LABEL[kpi.user.role as Role]} &bull; ${formatMonthLabel(kpi.period.month)}
  </div>

  <div style="text-align:center;margin:16px 0">
    <div class="card-title">Puntuación Global</div>
    <div class="score">${kpi.score}<span style="font-size:20px;color:#94a3b8">/100</span></div>
  </div>

  <h2>Cumplimiento ${colorEmoji(kpi.cumplimiento.color)}</h2>
  <div class="grid2">
    <div class="card">
      <div class="card-title">Tareas completadas</div>
      <div class="card-value">${kpi.cumplimiento.completedPct}%</div>
      <div class="note">${kpi.cumplimiento.completed} de ${kpi.cumplimiento.total} tareas</div>
    </div>
    <div class="card">
      <div class="card-title">Tareas vencidas</div>
      <div class="card-value">${kpi.cumplimiento.overdue}</div>
      <div class="note">Retraso promedio: ${kpi.cumplimiento.avgDelayDays} días</div>
    </div>
  </div>

  <h2>Carga Laboral ${colorEmoji(kpi.cargaLaboral.color)}</h2>
  <div class="grid2">
    <div class="card">
      <div class="card-title">Horas reales / estimadas</div>
      <div class="card-value">${kpi.cargaLaboral.ratio}%</div>
      <div class="note">${kpi.cargaLaboral.realHours}h reales de ${kpi.cargaLaboral.estimatedHours}h estimadas</div>
    </div>
    <div class="card">
      <div class="note" style="margin-top:12px">⚠️ Horas sobre el estimado pueden indicar exceso de carga laboral, no incumplimiento</div>
    </div>
  </div>

  <h2>Calidad</h2>
  <div class="grid2">
    <div class="card">
      <div class="card-title">Avance tareas en progreso</div>
      <div class="card-value">${kpi.calidad.avgProgress}%</div>
    </div>
    <div class="card">
      <div class="card-title">Tareas recurrentes</div>
      <div class="card-value">${kpi.calidad.recurringPct}%</div>
      <div class="note">${kpi.calidad.recurringCompleted}/${kpi.calidad.recurringTotal} completadas</div>
    </div>
  </div>

  <h2>Actividad</h2>
  <div class="grid2">
    <div class="card">
      <div class="card-title">Comentarios registrados</div>
      <div class="card-value">${kpi.actividad.totalComments}</div>
    </div>
    <div class="card">
      <div class="card-title">Asignadas por superior</div>
      <div class="card-value">${kpi.actividad.assignedByOthers}</div>
      <div class="note">${kpi.actividad.ownTasks} propias</div>
    </div>
  </div>

  ${
    kpi.seguimiento.total > 0
      ? `<h2>Seguimiento – ${kpi.seguimiento.total} consultas atendidas</h2>
  <table>
    <thead><tr><th>Motivo</th><th>Consultas</th><th>Total min</th><th>Promedio min</th></tr></thead>
    <tbody>
      ${kpi.seguimiento.byReason
        .map(
          (r) => `<tr>
        <td>${REASON_LABEL[r.reason] ?? r.reason}</td>
        <td>${r.count}</td>
        <td>${r.totalMinutes}</td>
        <td>${r.avgMinutes}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : ""
  }

  <h2>Detalle de Tareas del Período</h2>
  <table>
    <thead>
      <tr><th>Título</th><th>Tipo</th><th>Estado</th><th>Fecha fin</th><th>Retraso</th></tr>
    </thead>
    <tbody>
      ${kpi.tasks
        .map(
          (t) => `<tr>
        <td>${t.title}</td>
        <td>${TYPE_LABEL[t.type] ?? t.type}</td>
        <td>${STATUS_LABEL[t.status] ?? t.status}</td>
        <td>${new Date(t.endDate).toLocaleDateString("es-CL")}</td>
        <td>${t.delayDays > 0 ? `${t.delayDays}d` : "—"}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }
}

// ── KpisModule ────────────────────────────────────────────────────────────────

type Props = {
  currentUserId: string;
  currentUserRole: Role;
};

const CAN_ACCESS_REPORTS = ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"];

export default function KpisModule({ currentUserId: _uid, currentUserRole }: Props) {
  const canSeeReports = CAN_ACCESS_REPORTS.includes(currentUserRole);
  const [activeTab, setActiveTab] = useState<"kpis" | "informes">("kpis");
  const [month, setMonth] = useState(currentMonthParam);
  const [team, setTeam] = useState<TeamMemberKpi[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiFading, setKpiFading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Fetch team ─────────────────────────────────────────────────────────────

  const fetchTeam = useCallback(async (m: string) => {
    setTeamLoading(true);
    const res = await fetch(`/api/kpis/team?month=${m}`);
    if (res.ok) {
      const data: { users: TeamMemberKpi[] } = await res.json();
      setTeam(data.users);
      if (data.users.length > 0) {
        setSelectedId((prev) => prev ?? data.users[0].id);
      }
    }
    setTeamLoading(false);
  }, []);

  useEffect(() => {
    fetchTeam(month);
  }, [fetchTeam, month]);

  // ── Fetch individual KPI ───────────────────────────────────────────────────

  const fetchKpi = useCallback(
    async (userId: string, m: string) => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setKpiFading(true);
      await new Promise((r) => setTimeout(r, 120));
      setKpiFading(false);
      setKpiLoading(true);
      setKpi(null);

      try {
        const res = await fetch(`/api/kpis/${userId}?month=${m}`, {
          signal: ctrl.signal,
        });
        if (res.ok) setKpi(await res.json());
      } catch {
        // aborted
      } finally {
        setKpiLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedId) fetchKpi(selectedId, month);
  }, [selectedId, month, fetchKpi]);

  // ── Month change ───────────────────────────────────────────────────────────

  function handleMonthChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMonth(e.target.value);
    setTeam([]);
    setKpi(null);
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (teamLoading && activeTab === "kpis") {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selectedMember = team.find((m) => m.id === selectedId);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      {canSeeReports && (
        <div className="flex gap-1 bg-black/5 dark:bg-white/5 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab("kpis")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === "kpis"
                ? "bg-surface text-title shadow-sm"
                : "text-secondary hover:text-main"
            }`}
          >
            KPIs Individuales
          </button>
          <button
            onClick={() => setActiveTab("informes")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === "informes"
                ? "bg-surface text-title shadow-sm"
                : "text-secondary hover:text-main"
            }`}
          >
            Informes Mensuales
          </button>
        </div>
      )}

      {/* ── Monthly Reports tab ───────────────────────────────────────────── */}
      {activeTab === "informes" && canSeeReports && (
        <MonthlyReports currentUserRole={currentUserRole} />
      )}

      {/* ── KPIs tab ──────────────────────────────────────────────────────── */}
      {activeTab === "kpis" && team.length === 0 && !teamLoading && (
        <div className="flex flex-col items-center justify-center py-32 text-disabled">
          <svg className="w-12 h-12 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm">No tienes subordinados para visualizar KPIs</p>
        </div>
      )}

      {activeTab === "kpis" && team.length > 0 && (
      <div className="flex flex-col gap-4">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-title">KPIs del Equipo</h1>
          <p className="text-sm text-secondary mt-0.5">
            {team.length} {team.length === 1 ? "colaborador" : "colaboradores"} en seguimiento
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-secondary">Período:</label>
          <input
            type="month"
            value={month}
            onChange={handleMonthChange}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* ── Two-panel layout ─────────────────────────────────────────────── */}
      <div className="flex gap-5 items-start">
        {/* Left panel */}
        <aside className="w-[240px] shrink-0 bg-surface rounded-2xl border border-border p-3 sticky top-20">
          <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider px-2 mb-2">
            Colaboradores
          </p>
          <div className="space-y-1">
            {team.map((m) => (
              <SubordinateCard
                key={m.id}
                member={m}
                selected={m.id === selectedId}
                onClick={() => setSelectedId(m.id)}
              />
            ))}
          </div>
          <div className="mt-4 px-2 border-t border-border pt-3">
            <p className="text-[10px] text-disabled leading-relaxed">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />≥80% &bull;
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mx-1" />60–79% &bull;
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 mx-1" />&lt;60%
            </p>
          </div>
        </aside>

        {/* Right panel */}
        <div
          className={`flex-1 min-w-0 transition-opacity duration-150 ${kpiFading ? "opacity-0" : "opacity-100"}`}
        >
          {kpiLoading && !kpi && (
            <div className="flex justify-center py-24">
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {kpi && (
            <div className="space-y-5">
              {/* ── Person header ────────────────────────────────────────── */}
              <div className="bg-surface rounded-2xl border border-border px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient(kpi.user.name)} flex items-center justify-center shrink-0`}
                  >
                    <span className="text-lg font-bold text-white">{initials(kpi.user.name)}</span>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-title">{kpi.user.name}</h2>
                    <p className="text-sm text-secondary">{ROLE_LABEL[kpi.user.role as Role]}</p>
                  </div>
                  <div
                    className={`ml-4 w-16 h-16 rounded-full ring-4 ${COLOR_RING[kpi.cumplimiento.color]} bg-surface flex flex-col items-center justify-center`}
                  >
                    <span className="text-2xl font-extrabold text-title leading-none">
                      {kpi.score}
                    </span>
                    <span className="text-[10px] text-disabled leading-none">/100</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => downloadExcel(kpi)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Excel
                  </button>
                  <button
                    onClick={() => downloadPDF(kpi)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary rounded-lg text-white hover:bg-primary-hover transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    PDF
                  </button>
                </div>
              </div>

              {/* ── 4 Summary cards ──────────────────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  title="Cumplimiento"
                  value={kpi.cumplimiento.completedPct}
                  unit="%"
                  color={kpi.cumplimiento.color}
                  delta={kpi.cumplimiento.completedPct - (kpi.prevMonth?.completedPct ?? kpi.cumplimiento.completedPct)}
                  icon={
                    <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                />
                <SummaryCard
                  title="Carga laboral"
                  value={kpi.cargaLaboral.ratio}
                  unit="%"
                  color={kpi.cargaLaboral.color}
                  delta={kpi.cargaLaboral.ratio - (kpi.prevMonth?.cargaRatio ?? kpi.cargaLaboral.ratio)}
                  invertDelta
                  icon={
                    <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                />
                <SummaryCard
                  title="Total tareas"
                  value={kpi.cumplimiento.total}
                  color="gray"
                  delta={kpi.cumplimiento.total - (kpi.prevMonth?.totalTasks ?? kpi.cumplimiento.total)}
                  icon={
                    <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  }
                />
                <SummaryCard
                  title="Consultas SEGUIMIENTO"
                  value={kpi.seguimiento.total}
                  color="gray"
                  delta={kpi.seguimiento.total - (kpi.prevMonth?.seguimientoTotal ?? kpi.seguimiento.total)}
                  icon={
                    <svg className="w-5 h-5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  }
                />
              </div>

              {/* ── Donuts + weekly hours ─────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Donuts */}
                <Section title="Indicadores">
                  <div className="flex items-center justify-around py-3">
                    <DonutChart
                      pct={kpi.cumplimiento.completedPct}
                      color={kpi.cumplimiento.color}
                      label="Cumplimiento"
                      sublabel={`${kpi.cumplimiento.completed}/${kpi.cumplimiento.total} tareas`}
                    />
                    <div className="w-px h-24 bg-border" />
                    <DonutChart
                      pct={Math.min(kpi.cargaLaboral.ratio, 100)}
                      color={kpi.cargaLaboral.color}
                      label="Carga laboral"
                      sublabel={`${kpi.cargaLaboral.realHours}h / ${kpi.cargaLaboral.estimatedHours}h`}
                    />
                  </div>
                  <div className="mt-3 space-y-1">
                    <MetricRow label="Tareas vencidas" value={`${kpi.cumplimiento.overdue}`} />
                    <MetricRow label="Días promedio retraso" value={`${kpi.cumplimiento.avgDelayDays}d`} />
                    <MetricRow label="Avance tareas activas" value={`${kpi.calidad.avgProgress}%`} />
                    <MetricRow
                      label="Recurrentes completadas"
                      value={`${kpi.calidad.recurringCompleted}/${kpi.calidad.recurringTotal}`}
                    />
                  </div>
                </Section>

                {/* Weekly hours */}
                <div className="lg:col-span-2">
                  <Section title="Horas estimadas vs reales por semana">
                    <WeeklyHoursChart data={kpi.horasByWeek} />
                    {kpi.cargaLaboral.ratio > 100 && (
                      <p className="text-[11px] text-amber-600 mt-2 italic">
                        ⚠️ Horas sobre el estimado pueden indicar exceso de carga laboral, no incumplimiento
                      </p>
                    )}
                  </Section>
                </div>
              </div>

              {/* ── Cumplimiento history ──────────────────────────────────── */}
              <Section title="Evolución del cumplimiento – últimos 6 meses">
                <CumplimientoLineChart data={kpi.cumplimientoHistory} />
                <div className="flex items-center gap-4 mt-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-secondary">
                    <div className="w-6 h-0.5 bg-green-400 border-dashed border-t-2 border-green-400" />
                    Objetivo 80%
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-secondary">
                    <div className="w-6 h-0.5 bg-amber-400 border-dashed border-t-2 border-amber-400" />
                    Alerta 60%
                  </div>
                </div>
              </Section>

              {/* ── Actividad ─────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <Section title="Actividad">
                  <div className="space-y-1">
                    <MetricRow
                      label="Comentarios en el período"
                      value={kpi.actividad.totalComments}
                    />
                    <MetricRow
                      label="Asignadas por superior"
                      value={kpi.actividad.assignedByOthers}
                    />
                    <MetricRow label="Tareas propias" value={kpi.actividad.ownTasks} />
                  </div>
                </Section>

                {/* Consultas chart */}
                {kpi.seguimiento.byReason.length > 0 && (
                  <div className="lg:col-span-2">
                    <Section title="Consultas por motivo (SEGUIMIENTO)">
                      <ConsultasBarChart data={kpi.seguimiento.byReason} />
                    </Section>
                  </div>
                )}

                {kpi.seguimiento.byReason.length === 0 && (
                  <div className="lg:col-span-2">
                    <Section title="Consultas por motivo (SEGUIMIENTO)">
                      <div className="flex items-center justify-center h-28 text-disabled text-sm">
                        Sin tareas de tipo SEGUIMIENTO en este período
                      </div>
                    </Section>
                  </div>
                )}
              </div>

              {/* ── Tasks table ───────────────────────────────────────────── */}
              <Section
                title={`Detalle de tareas del período (${kpi.tasks.length})`}
              >
                {kpi.tasks.length === 0 ? (
                  <p className="text-sm text-disabled py-6 text-center">
                    Sin tareas con fecha de vencimiento en este período
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-5 px-5">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">
                            Título
                          </th>
                          <th className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">
                            Tipo
                          </th>
                          <th className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">
                            Estado
                          </th>
                          <th className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">
                            Fecha fin
                          </th>
                          <th className="text-left py-2 pr-4 text-xs font-semibold text-secondary uppercase tracking-wider">
                            Retraso
                          </th>
                          <th className="py-2 text-xs font-semibold text-secondary uppercase tracking-wider" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {kpi.tasks.map((t) => (
                          <tr key={t.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                            <td className="py-2.5 pr-4 max-w-[220px]">
                              <p className="text-sm font-medium text-title truncate" title={t.title}>
                                {t.title}
                              </p>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className="text-[11px] font-medium text-secondary">
                                {TYPE_LABEL[t.type] ?? t.type}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status] ?? "bg-slate-100 text-slate-700"}`}
                              >
                                {STATUS_LABEL[t.status] ?? t.status}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-sm text-main whitespace-nowrap">
                              {formatDate(t.endDate)}
                            </td>
                            <td className="py-2.5 pr-4 text-sm">
                              {t.delayDays > 0 ? (
                                <span className="text-red-600 font-medium">{t.delayDays}d</span>
                              ) : (
                                <span className="text-disabled">—</span>
                              )}
                            </td>
                            <td className="py-2.5 text-right">
                              <div
                                className={`inline-block w-2.5 h-2.5 rounded-full ${DOT_CLASS[t.color]}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </div>
          )}

          {!kpiLoading && !kpi && selectedMember && (
            <div className="flex items-center justify-center py-24 text-disabled text-sm">
              Error al cargar KPIs. Intenta de nuevo.
            </div>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
