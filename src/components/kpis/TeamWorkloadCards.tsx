"use client";

import { useState } from "react";
import type { TeamMemberKpi, WorkloadColor, CapacityMember, CapacitySummary } from "./types";
import { hoursToDisplay, displayToHours, validateDisplayHours } from "@/lib/timeFormat";

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

/** Recalcula el estado/color/etiqueta del semáforo a partir de disponible/base — misma regla que computeTeamCapacityForecast, usada por el simulador (client-only, no toca datos reales). */
function estadoFor(disponible: number, baseFuturaTotal: number): { color: keyof typeof ESTADO_EMOJI; label: string } {
  if (baseFuturaTotal <= 0) return { color: "gray", label: "Sin planificación disponible este mes" };
  if (disponible < 0) return { color: "red", label: `Sobrecarga proyectada: ${fmtSignedHours(disponible)}` };
  const pct = Math.round((disponible / baseFuturaTotal) * 100);
  if (pct > 20) return { color: "green", label: "Puede asumir proyectos" };
  if (pct >= 10) return { color: "yellow", label: "Capacidad limitada" };
  return { color: "red", label: "No asignar nuevas tareas" };
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
      <p className={!c.unregisteredAbsenceSuspected ? "text-success" : "text-warning"}>
        {!c.unregisteredAbsenceSuspected ? "✓ Sin ausencias sin registrar detectadas" : "⚠ Posible ausencia sin registrar en días laborables"}
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

function SimulatorPanel({ member, onClose }: { member: CapacityMember; onClose: () => void }) {
  const [input, setInput] = useState("");
  const valid = input.trim() === "" || validateDisplayHours(input);
  const newHours = valid && input.trim() !== "" ? displayToHours(input) : 0;
  const before = estadoFor(member.disponible, member.baseFuturaTotal);
  const disponibleAfter = Math.round((member.disponible - newHours) * 100) / 100;
  const after = estadoFor(disponibleAfter, member.baseFuturaTotal);
  const afterPct = member.baseFuturaTotal > 0 ? Math.round((disponibleAfter / member.baseFuturaTotal) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm h-full bg-surface border-l border-border shadow-2xl p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">Simulador de asignación</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <Avatar name={member.name} />
          <p className="text-sm font-semibold text-title">{member.name}</p>
        </div>

        <label className="block text-xs font-medium text-secondary mb-1.5">Horas estimadas de nueva tarea (HH.MM)</label>
        <input
          type="text"
          inputMode="decimal"
          placeholder="ej: 16.00"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className={`w-full text-sm border rounded-lg px-3 py-2 bg-background text-main focus:outline-none focus:ring-2 focus:ring-primary ${
            valid ? "border-border" : "border-danger"
          }`}
        />
        {!valid && <p className="text-xs text-danger mt-1">Formato inválido. Usa HH.MM (ej: 6.30 = 6h 30min)</p>}

        <div className="mt-5 space-y-3">
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Antes</p>
            <p className={`text-sm font-bold ${ESTADO_TEXT[before.color]}`}>
              {ESTADO_EMOJI[before.color]} {fmtSignedHours(member.disponible)} disponibles ({member.disponiblePct}%)
            </p>
          </div>
          <div className="flex justify-center text-disabled">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
          <div className={`rounded-xl border p-3 ${after.color === "red" ? "border-danger/30 bg-danger/[.06]" : after.color === "yellow" ? "border-warning/30 bg-warning/[.08]" : "border-success/30 bg-success/[.08]"}`}>
            <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">
              Después de asignar {input.trim() !== "" && valid ? `${input}h` : "—"}
            </p>
            <p className={`text-sm font-bold ${ESTADO_TEXT[after.color]}`}>
              {ESTADO_EMOJI[after.color]} {fmtSignedHours(disponibleAfter)} disponibles ({afterPct}%)
            </p>
            <p className={`text-xs mt-1 ${ESTADO_TEXT[after.color]}`}>{after.label}</p>
          </div>
        </div>

        <p className="text-[11px] text-disabled mt-4">Esto es solo una simulación visual — no guarda ni asigna ninguna tarea.</p>

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
