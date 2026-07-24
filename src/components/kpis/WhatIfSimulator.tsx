"use client";

import { useState, useEffect } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { validateDisplayHours, displayToHours } from "@/lib/timeFormat";
import type { WorkloadColor, WorkloadLabel } from "./types";
import { Button } from "@/components/ui/Button";

/**
 * Panel personal "¿Qué pasaría si...?" (Sprint A §2/§3) — versión standalone
 * para el propio colaborador, separada de `SimulatorPanel` en
 * `TeamWorkloadCards.tsx` (que sigue intacto, uso de líderes sobre un
 * miembro del equipo) para no arriesgar ese flujo ya en producción. Llama al
 * mismo endpoint (`POST /api/analytics/simulate/[userId]`), que NUNCA
 * persiste nada — al cerrar el panel, todo el resultado se descarta.
 */

type ScenarioType = "complete_task" | "reduce_overdue" | "increase_consistency" | "register_hours" | "assign_task" | "daily_hours" | "vacation" | "permiso";

const SCENARIO_GROUPS: Array<{ label: string; types: ScenarioType[] }> = [
  { label: "Rendimiento", types: ["complete_task", "reduce_overdue", "increase_consistency"] },
  { label: "Carga y capacidad", types: ["register_hours", "assign_task", "daily_hours", "vacation", "permiso"] },
];

const SCENARIO_LABEL: Record<ScenarioType, string> = {
  complete_task: "Completar tareas",
  reduce_overdue: "Reducir vencidas",
  increase_consistency: "Subir consistencia",
  register_hours: "Registrar horas",
  assign_task: "Nueva tarea",
  daily_hours: "Horas efectivas",
  vacation: "Vacaciones",
  permiso: "Permiso",
};

type FieldSpec = { key: string; label: string; placeholder: string; kind: "hours" | "number" };

const SCENARIO_FIELDS: Record<ScenarioType, FieldSpec[]> = {
  complete_task: [{ key: "count", label: "Tareas a completar", placeholder: "ej: 2", kind: "number" }],
  reduce_overdue: [
    { key: "count", label: "Tareas vencidas a resolver", placeholder: "ej: 2", kind: "number" },
    { key: "alta", label: "De esas, prioridad Alta", placeholder: "ej: 1", kind: "number" },
  ],
  increase_consistency: [{ key: "deltaPoints", label: "Puntos adicionales de consistencia", placeholder: "ej: 10", kind: "number" }],
  register_hours: [{ key: "hours", label: "Horas adicionales trabajadas este mes (HH.MM)", placeholder: "ej: 4.00", kind: "hours" }],
  assign_task: [{ key: "hours", label: "Tiempo objetivo de la nueva tarea (HH.MM)", placeholder: "ej: 16.00", kind: "hours" }],
  daily_hours: [{ key: "newHoursPerDay", label: "Nuevas horas efectivas por día", placeholder: "ej: 7.00", kind: "hours" }],
  vacation: [{ key: "days", label: "Días de vacaciones", placeholder: "ej: 5", kind: "number" }],
  permiso: [{ key: "hours", label: "Horas de permiso", placeholder: "ej: 4.00", kind: "hours" }],
};

const SCENARIO_NOTE: Record<ScenarioType, string> = {
  complete_task: "Afecta el Performance Score (factor Cumplimiento).",
  reduce_overdue: "Afecta el Performance Score (factor Tareas vencidas).",
  increase_consistency: "Afecta el Performance Score (factor Consistencia).",
  register_hours: "Afecta la Carga Laboral y el Score de Salud — el Performance Score no pondera horas trabajadas directamente.",
  assign_task: "Afecta la Capacidad Disponible y el Score de Salud.",
  daily_hours: "Afecta la Carga Laboral, la Capacidad Disponible y el Score de Salud.",
  vacation: "Afecta la Capacidad Disponible y el Score de Salud.",
  permiso: "Afecta la Carga Laboral, la Capacidad Disponible y el Score de Salud.",
};

type Snapshot = {
  cargaPct: number;
  cargaLabel: WorkloadLabel;
  cargaColor: WorkloadColor;
  capacidadDisponiblePct: number;
  capacidadDisponibleHoras: number;
  cumplimientoPct: number;
  healthScore: number;
  healthClassification: string;
  performanceScorePts: number;
  performanceScoreClass: string;
};

type SimResult = { before: Snapshot; after: Snapshot; diff: { healthScore: number; performanceScore: number } };

const HEALTH_CLASS_TEXT: Record<string, string> = { Excelente: "text-success", Bueno: "text-success", Riesgo: "text-warning", Crítico: "text-danger" };
const CARGA_COLOR_TEXT: Record<WorkloadColor, string> = { green: "text-success", yellow: "text-warning", orange: "text-orange-500", red: "text-danger" };

function DiffRow({ label, before, after, unit = "" }: { label: string; before: number; after: number; unit?: string }) {
  const delta = Math.round((after - before) * 100) / 100;
  const improved = delta > 0;
  const worsened = delta < 0;
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-secondary">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-disabled">{before}{unit}</span>
        <span className="text-disabled">→</span>
        <span className="font-semibold text-title">{after}{unit}</span>
        {delta !== 0 && (
          <span className={`font-bold ${improved ? "text-success" : worsened ? "text-danger" : "text-disabled"}`}>
            ({delta > 0 ? "+" : ""}{delta}{unit})
          </span>
        )}
      </span>
    </div>
  );
}

export default function WhatIfSimulator({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<ScenarioType>("complete_task");
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = SCENARIO_FIELDS[scenario];

  function fieldValid(f: FieldSpec): boolean {
    const v = values[f.key] ?? "";
    if (v.trim() === "") return true;
    return f.kind === "hours" ? validateDisplayHours(v) : /^\d+(\.\d+)?$/.test(v.trim());
  }
  const allValid = fields.every(fieldValid);

  useEffect(() => {
    queueMicrotask(() => {
      setResult(null);
      setError(null);
    });
    if (!open || !allValid) return;
    const raw: Record<string, number> = {};
    for (const f of fields) {
      const v = values[f.key] ?? "";
      if (v.trim() === "") return;
      raw[f.key] = f.kind === "hours" ? displayToHours(v) : Number(v);
    }
    if (Object.values(raw).some((n) => !(n >= 0))) return;
    if (scenario !== "reduce_overdue" && Object.values(raw).some((n) => !(n > 0))) return;

    const timeout = setTimeout(() => {
      setLoading(true);
      fetch(`/api/analytics/simulate/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: scenario, ...raw }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Error al simular");
          }
          return res.json();
        })
        .then((data: SimResult) => setResult(data))
        .catch((e) => setError(e instanceof Error ? e.message : "Error al simular"))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, values, allValid, open, userId]);

  if (!open) {
    return (
      <Button variant="tertiary" onClick={() => setOpen(true)}>
        ¿Qué pasaría si...?
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-sm h-full bg-surface border-l border-border shadow-2xl p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">¿Qué pasaría si...?</h3>
          <button onClick={() => setOpen(false)} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {SCENARIO_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="text-[10px] font-semibold text-disabled uppercase tracking-wider mb-1.5">{group.label}</p>
            <div className="flex gap-1 bg-background rounded-lg p-1 flex-wrap">
              {group.types.map((t) => (
                <button
                  key={t}
                  onClick={() => { setScenario(t); setValues({}); }}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    scenario === t ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-title"
                  }`}
                >
                  {SCENARIO_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        ))}

        <p className="text-[11px] text-disabled italic mb-3">{SCENARIO_NOTE[scenario]}</p>

        <div className="space-y-3 mb-2">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-secondary mb-1.5">{f.label}</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={`w-full text-sm border rounded-lg px-3 py-2 bg-background text-main focus:outline-none focus:ring-2 focus:ring-primary ${
                  fieldValid(f) ? "border-border" : "border-danger"
                }`}
              />
              {!fieldValid(f) && (
                <p className="text-xs text-danger mt-1">Formato inválido{f.kind === "hours" ? " — usa HH.MM (ej: 6.30 = 6h 30min)" : ""}.</p>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-danger mt-1">{error}</p>}

        {loading && (
          <div className="flex justify-center py-6">
            <Spinner className="w-5 h-5 text-primary" />
          </div>
        )}

        {!loading && result && (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-primary/30 bg-primary-surface/40 p-3">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-1.5">Impacto estimado</p>
              <DiffRow label="Performance Score" before={result.before.performanceScorePts} after={result.after.performanceScorePts} unit=" pts" />
              <DiffRow label="Score de Salud" before={result.before.healthScore} after={result.after.healthScore} unit=" pts" />
            </div>

            <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">Antes</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-secondary">Performance: <strong className="text-main">{result.before.performanceScorePts} ({result.before.performanceScoreClass})</strong></span>
                <span className="text-secondary">Score Salud: <strong className={HEALTH_CLASS_TEXT[result.before.healthClassification]}>{result.before.healthScore}</strong></span>
                <span className="text-secondary">Carga: <strong className="text-main">{result.before.cargaLabel} ({result.before.cargaPct}%)</strong></span>
                <span className="text-secondary">Capacidad: <strong className="text-main">{result.before.capacidadDisponiblePct}%</strong></span>
              </div>
            </div>
            <div className="flex justify-center text-disabled">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary-surface p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-1">Simulado</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-secondary">Performance: <strong className="text-main">{result.after.performanceScorePts} ({result.after.performanceScoreClass})</strong></span>
                <span className="text-secondary">Score Salud: <strong className={HEALTH_CLASS_TEXT[result.after.healthClassification]}>{result.after.healthScore}</strong></span>
                <span className="text-secondary">Carga: <strong className={CARGA_COLOR_TEXT[result.after.cargaColor]}>{result.after.cargaLabel} ({result.after.cargaPct}%)</strong></span>
                <span className="text-secondary">Capacidad: <strong className="text-main">{result.after.capacidadDisponiblePct}%</strong></span>
              </div>
            </div>
          </div>
        )}

        <p className="text-[11px] text-disabled mt-4">Esto es solo una simulación visual — no guarda ni modifica ningún dato real.</p>

        <Button variant="secondary" onClick={() => setOpen(false)} className="mt-5 w-full">
          Cerrar simulación
        </Button>
      </div>
    </div>
  );
}
