"use client";

import type { TeamMemberKpi, WorkloadColor } from "./types";
import { hoursToDisplay } from "@/lib/timeFormat";

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

// ── Componente 2: Capacidad disponible del equipo ────────────────────────────

export function CapacityAvailableCard({ members }: { members: TeamMemberKpi[] }) {
  const available = members
    .filter((m) => m.capacidadDisponiblePct > 15)
    .sort((a, b) => b.capacidadDisponiblePct - a.capacidadDisponiblePct);

  return (
    <div className="bg-surface rounded-[14px] border border-border shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider">Capacidad disponible del equipo</h3>
      </div>
      {available.length === 0 ? (
        <p className="text-sm text-disabled py-6 text-center">
          Nadie tiene capacidad disponible relevante este mes
        </p>
      ) : (
        <div className="space-y-3">
          {available.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-title truncate">{m.name}</p>
                <p className="text-[11px] text-secondary">Tiene capacidad para asumir nuevos proyectos</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-success">{m.capacidadDisponiblePct}% disponible</p>
                <p className="text-[11px] text-disabled">~{hoursToDisplay(m.horasDisponibles)}h este mes</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
