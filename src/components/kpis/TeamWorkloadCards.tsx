"use client";

import { useState, useEffect } from "react";
import type { TeamMemberKpi, WorkloadColor, WorkloadLabel, CapacityMember, CapacitySummary } from "./types";
import { hoursToDisplay, displayToHours, validateDisplayHours } from "@/lib/timeFormat";
import { canViewOperationalRisk } from "@/lib/roles";
import { isFeatureEnabled } from "@/lib/featureFlags";
import type { Role } from "@/generated/prisma/client";

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
  return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const BAR_CLASS: Record<WorkloadColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  orange: "bg-orange-500",
  red: "bg-danger",
};

const DOT_CLASS: Record<WorkloadColor, string> = BAR_CLASS;

function Avatar({ name }: { name: string }) {
  return (
    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${avatarGradient(name)} flex items-center justify-center shrink-0`}>
      <span className="text-[11px] font-bold text-white">{initials(name)}</span>
    </div>
  );
}

// ── Componente 1: Balance de carga del equipo ────────────────────────────────

export function WorkloadBalanceCard({ members }: { members: TeamMemberKpi[] }) {
  const sorted = [...members].sort((a, b) => b.cargaPct - a.cargaPct);

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Balance de carga del equipo</h3>
        <span className="text-xs text-disabled">{members.length} {members.length === 1 ? "colaborador" : "colaboradores"}</span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-disabled py-6 text-center">Sin colaboradores para mostrar</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar name={m.name} />
              <span className="text-sm font-medium text-title w-28 shrink-0 truncate" title={m.name}>
                {m.name}
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-surface2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${BAR_CLASS[m.cargaColor]} transition-all`}
                  style={{ width: `${Math.min(m.cargaPct, 100)}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-main w-11 text-right shrink-0">{m.cargaPct}%</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[m.cargaColor]}`} title={m.cargaLabel} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente 2: Capacidad para asumir nuevas tareas ────────────────────────

const ESTADO_EMOJI: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" };
const ESTADO_DOT: Record<string, string> = { green: "bg-success", yellow: "bg-warning", red: "bg-danger", gray: "bg-disabled" };
const ESTADO_TEXT: Record<string, string> = { green: "text-success", yellow: "text-warning", red: "text-danger", gray: "text-disabled" };

function fmtSignedHours(h: number): string {
  const sign = h < 0 ? "-" : "";
  return `${sign}${hoursToDisplay(Math.abs(h))}h`;
}

function ExecutiveSummaryBox({ summary }: { summary: CapacitySummary }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 mb-4">
      <p className="text-sm font-semibold text-title mb-2">
        Equipo — {summary.total} {summary.total === 1 ? "colaborador" : "colaboradores"}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <span className="text-success font-medium">🟢 {summary.alta} con capacidad alta</span>
        <span className="text-warning font-medium">🟡 {summary.limitada} capacidad limitada</span>
        <span className="text-danger font-medium">🔴 {summary.sobrecargados} sobrecargados</span>
        {summary.sinPlanificacion > 0 && (
          <span className="text-disabled font-medium">⚪ {summary.sinPlanificacion} sin planificación</span>
        )}
      </div>
    </div>
  );
}

function ConfiabilidadLine({ member }: { member: CapacityMember }) {
  const c = member.confiabilidad;
  return (
    <div className="text-xs text-secondary mt-2 pt-2 border-t border-border space-y-0.5">
      <p className="font-semibold text-main">Confiabilidad del cálculo: {c.pct}%</p>
      <p className={c.tasksWithoutEstimate === 0 ? "text-success" : "text-warning"}>
        {c.tasksWithoutEstimate === 0 ? "✓" : "⚠"} {c.tasksWithoutEstimate === 0 ? "Todas las tareas estimadas" : `${c.tasksWithoutEstimate} ${c.tasksWithoutEstimate === 1 ? "tarea sin estimación" : "tareas sin estimación"}`}
      </p>
      <p className={c.holidaysConfigured ? "text-success" : "text-warning"}>
        {c.holidaysConfigured ? "✓ Feriados configurados" : "⚠ Sin feriados configurados para este año"}
      </p>
    </div>
  );
}

function CapacityRow({
  member,
  expanded,
  onToggleExpand,
  onSimulate,
}: {
  member: CapacityMember;
  expanded: boolean;
  onToggleExpand: () => void;
  onSimulate: () => void;
}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <Avatar name={member.name} />
        <span className="text-sm font-medium text-title w-28 shrink-0 truncate" title={member.name}>
          {member.name}
        </span>
        <div className="hidden sm:flex flex-1 items-center gap-4 text-xs text-secondary">
          <span>Base restante: <strong className="text-main">{hoursToDisplay(member.baseFuturaTotal)}h</strong></span>
          <span>Comprometido: <strong className="text-main">{hoursToDisplay(member.comprometidoFuturo)}h</strong></span>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-sm font-bold ${ESTADO_TEXT[member.estadoColor]}`}>
            {fmtSignedHours(member.disponible)} ({member.disponiblePct}%)
          </span>
          <span className={`w-2.5 h-2.5 rounded-full ${ESTADO_DOT[member.estadoColor]}`} title={member.estadoLabel} />
          <svg className={`w-4 h-4 text-disabled transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-background border-t border-border">
          <p className={`text-sm font-semibold mb-2 ${ESTADO_TEXT[member.estadoColor]}`}>
            {ESTADO_EMOJI[member.estadoColor]} {member.estadoLabel}
          </p>
          <div className="text-xs text-secondary space-y-1">
            <p>Horas restantes hoy: <strong className="text-main">{hoursToDisplay(member.horasRestantesHoy)}h</strong></p>
            <p>
              Días laborables restantes: <strong className="text-main">{member.diasLaborablesRestantes} días</strong>
              {member.horasRestantesHoy > 0 && " (+ hoy parcial)"}
            </p>
            <p>Base futura total: <strong className="text-main">{hoursToDisplay(member.baseFuturaTotal)}h</strong></p>
            <p className="pl-3">— Tareas en progreso (restante): {hoursToDisplay(member.comprometidoEnProgreso)}h</p>
            <p className="pl-3">— Tareas pendientes (este mes): {hoursToDisplay(member.comprometidoPendiente)}h</p>
            <p>= Comprometido futuro: <strong className="text-main">{hoursToDisplay(member.comprometidoFuturo)}h</strong></p>
            <p>
              = Disponible: <strong className={ESTADO_TEXT[member.estadoColor]}>{fmtSignedHours(member.disponible)} ({member.disponiblePct}%) {ESTADO_EMOJI[member.estadoColor]}</strong>
            </p>
          </div>
          {member.tasksSinEstimar > 0 && (
            <p className="text-xs text-warning font-medium mt-2">
              ⚠ {member.tasksSinEstimar} {member.tasksSinEstimar === 1 ? "tarea no tiene" : "tareas no tienen"} horas estimadas. La capacidad proyectada puede estar subestimada.
            </p>
          )}
          <ConfiabilidadLine member={member} />
          <button
            onClick={onSimulate}
            className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-surface text-primary hover:bg-primary/20 transition-colors"
          >
            Simular asignación
          </button>
        </div>
      )}
    </div>
  );
}

const CARGA_COLOR_TEXT: Record<WorkloadColor, string> = { green: "text-success", yellow: "text-warning", orange: "text-orange-500", red: "text-danger" };

type ScenarioType = "assign_task" | "daily_hours" | "vacation" | "permiso";

const SCENARIO_TABS: Array<{ type: ScenarioType; label: string }> = [
  { type: "assign_task", label: "Nueva tarea" },
  { type: "daily_hours", label: "Horas efectivas" },
  { type: "vacation", label: "Vacaciones" },
  { type: "permiso", label: "Permiso" },
];

const SCENARIO_FIELD: Record<ScenarioType, { label: string; placeholder: string; suffix: string }> = {
  assign_task: { label: "Horas estimadas de la nueva tarea (HH.MM)", placeholder: "ej: 16.00", suffix: "h" },
  daily_hours: { label: "Nuevas horas efectivas por día", placeholder: "ej: 7.00", suffix: "h/día" },
  vacation: { label: "Días de vacaciones", placeholder: "ej: 5", suffix: "días" },
  permiso: { label: "Horas de permiso", placeholder: "ej: 4.00", suffix: "h" },
};

type SimSnapshot = {
  cargaPct: number;
  cargaLabel: WorkloadLabel;
  cargaColor: WorkloadColor;
  capacidadDisponiblePct: number;
  capacidadDisponibleHoras: number;
  cumplimientoPct: number;
  healthScore: number;
  healthClassification: string;
};

const HEALTH_CLASS_TEXT: Record<string, string> = { Excelente: "text-success", Bueno: "text-success", Riesgo: "text-warning", Crítico: "text-danger" };

function SimulatorPanel({ member, onClose }: { member: CapacityMember; onClose: () => void }) {
  const [scenario, setScenario] = useState<ScenarioType>("assign_task");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ before: SimSnapshot; after: SimSnapshot } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHoursField = scenario === "assign_task" || scenario === "permiso";
  const valid = input.trim() === "" || (isHoursField ? validateDisplayHours(input) : /^\d+(\.\d+)?$/.test(input.trim()));
  const field = SCENARIO_FIELD[scenario];

  useEffect(() => {
    queueMicrotask(() => {
      setResult(null);
      setError(null);
    });
    if (input.trim() === "" || !valid) return;
    const raw = isHoursField ? displayToHours(input) : Number(input);
    if (!(raw > 0)) return;

    const body =
      scenario === "assign_task" ? { type: "assign_task", hours: raw }
      : scenario === "daily_hours" ? { type: "daily_hours", newHoursPerDay: raw }
      : scenario === "vacation" ? { type: "vacation", days: raw }
      : { type: "permiso", hours: raw };

    const timeout = setTimeout(() => {
      setLoading(true);
      fetch(`/api/analytics/simulate/${member.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Error al simular");
          }
          return res.json();
        })
        .then((data) => setResult(data))
        .catch((e) => setError(e instanceof Error ? e.message : "Error al simular"))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, input, valid, member.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm h-full bg-surface border-l border-border shadow-2xl p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">Simulador</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <Avatar name={member.name} />
          <p className="text-sm font-semibold text-title">{member.name}</p>
        </div>

        <div className="flex gap-1 bg-background rounded-lg p-1 mb-4 flex-wrap">
          {SCENARIO_TABS.map((t) => (
            <button
              key={t.type}
              onClick={() => { setScenario(t.type); setInput(""); }}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                scenario === t.type ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-title"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="block text-xs font-medium text-secondary mb-1.5">{field.label}</label>
        <input
          type="text"
          inputMode="decimal"
          placeholder={field.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className={`w-full text-sm border rounded-lg px-3 py-2 bg-background text-main focus:outline-none focus:ring-2 focus:ring-primary ${
            valid ? "border-border" : "border-danger"
          }`}
        />
        {!valid && <p className="text-xs text-danger mt-1">Formato inválido{isHoursField ? " — usa HH.MM (ej: 6.30 = 6h 30min)" : ""}.</p>}
        {error && <p className="text-xs text-danger mt-1">{error}</p>}

        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && result && (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Antes</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-secondary">Carga: <strong className="text-main">{result.before.cargaLabel} ({result.before.cargaPct}%)</strong></span>
                <span className="text-secondary">Capacidad: <strong className="text-main">{result.before.capacidadDisponiblePct}%</strong></span>
                <span className="text-secondary">Cumplimiento: <strong className="text-main">{result.before.cumplimientoPct}%</strong></span>
                <span className="text-secondary">Score Salud: <strong className={HEALTH_CLASS_TEXT[result.before.healthClassification]}>{result.before.healthScore}</strong></span>
              </div>
            </div>
            <div className="flex justify-center text-disabled">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary-surface p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-1">Después</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-secondary">Carga: <strong className={CARGA_COLOR_TEXT[result.after.cargaColor]}>{result.after.cargaLabel} ({result.after.cargaPct}%)</strong></span>
                <span className="text-secondary">Capacidad: <strong className="text-main">{result.after.capacidadDisponiblePct}%</strong></span>
                <span className="text-secondary">Cumplimiento: <strong className="text-main">{result.after.cumplimientoPct}%</strong></span>
                <span className="text-secondary">Score Salud: <strong className={HEALTH_CLASS_TEXT[result.after.healthClassification]}>{result.after.healthScore} ({result.after.healthClassification})</strong></span>
              </div>
            </div>
          </div>
        )}

        <p className="text-[11px] text-disabled mt-4">Esto es solo una simulación visual — no guarda ni modifica ningún dato real.</p>

        <button
          onClick={onClose}
          className="mt-5 w-full text-sm font-medium px-3 py-2 rounded-lg border border-border text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          Cerrar simulación
        </button>
      </div>
    </div>
  );
}

// ── Componente 3: Recomendaciones deterministas con impacto (§S3-A) ─────────

type TeamRecommendation = {
  priority: "alta" | "media";
  priorityColor: "red" | "yellow";
  text: string;
  impactScorePts: number;
  impactRiskPts: number;
};

export function TeamRecommendationsCard({ currentUserRole }: { currentUserRole: Role }) {
  const [recommendations, setRecommendations] = useState<TeamRecommendation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const canView = canViewOperationalRisk(currentUserRole) && isFeatureEnabled("enableRecommendationEngine");

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/analytics/recommendations/team");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setRecommendations(data.recommendations);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView]);

  if (!canView) return null;

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <h3 className="text-sm font-semibold text-main uppercase tracking-wider mb-3">Recomendaciones — motor determinista</h3>
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !recommendations || recommendations.length === 0 ? (
        <p className="text-sm text-disabled py-4 text-center">Sin redistribuciones sugeridas — equipo balanceado.</p>
      ) : (
        <div className="space-y-3">
          {recommendations.map((r, i) => (
            <div
              key={i}
              className={`rounded-xl p-3.5 border ${r.priorityColor === "red" ? "border-danger/30 bg-danger/[.05]" : "border-warning/30 bg-warning/[.06]"}`}
            >
              <p className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${r.priorityColor === "red" ? "text-danger" : "text-warning"}`}>
                {r.priorityColor === "red" ? "🔴" : "🟡"} Prioridad {r.priority === "alta" ? "Alta" : "Media"}
              </p>
              <p className="text-sm text-title mb-2">{r.text}</p>
              <p className="text-[11px] text-secondary">
                Impacto esperado:{" "}
                <strong className={r.impactScorePts >= 0 ? "text-success" : "text-danger"}>
                  {r.impactScorePts >= 0 ? "+" : ""}{r.impactScorePts} pts Score
                </strong>{" "}
                |{" "}
                <strong className={r.impactRiskPts <= 0 ? "text-success" : "text-danger"}>
                  {r.impactRiskPts > 0 ? "+" : ""}{r.impactRiskPts} pts Riesgo Operativo
                </strong>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamCapacityCard({ members, summary }: { members: CapacityMember[]; summary: CapacitySummary }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<CapacityMember | null>(null);
  const sorted = [...members].sort((a, b) => a.disponible - b.disponible);
  const anyMissingEstimate = members.some((m) => m.tasksSinEstimar > 0);
  const totalMissingEstimate = members.reduce((s, m) => s + m.tasksSinEstimar, 0);

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Capacidad para asumir nuevas tareas</h3>
      </div>
      <ExecutiveSummaryBox summary={summary} />
      {anyMissingEstimate && (
        <p className="text-xs text-warning font-medium mb-3">
          ⚠ {totalMissingEstimate} {totalMissingEstimate === 1 ? "tarea no tiene" : "tareas no tienen"} horas estimadas. La capacidad proyectada puede estar subestimada.
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-disabled py-6 text-center">Sin colaboradores para mostrar</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((m) => (
            <CapacityRow
              key={m.id}
              member={m}
              expanded={expandedId === m.id}
              onToggleExpand={() => setExpandedId((prev) => (prev === m.id ? null : m.id))}
              onSimulate={() => setSimulating(m)}
            />
          ))}
        </div>
      )}
      {simulating && <SimulatorPanel member={simulating} onClose={() => setSimulating(null)} />}
    </div>
  );
}
