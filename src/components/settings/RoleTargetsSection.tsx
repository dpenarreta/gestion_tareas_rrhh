"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";
import type { Role } from "@/generated/prisma/client";

type RoleTarget = { performance: number | null; riesgoMax: number | null; cumplimiento: number | null };
type Targets = Partial<Record<Role, RoleTarget>>;

const EMPTY_TARGET: RoleTarget = { performance: null, riesgoMax: null, cumplimiento: null };

function toInput(v: number | null): string {
  return v === null ? "" : String(v);
}
function fromInput(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Objetivo esperado del cargo (§Sprint 7) — configuración OPCIONAL usada
 * únicamente como referencia en el Benchmark Personal (Nivel 3, cargo único).
 * Nunca modifica el cálculo de ningún KPI; si un cargo no tiene objetivo
 * configurado, el motor oculta esa comparación en vez de inventar un valor.
 */
export default function RoleTargetsSection() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Targets | null>(null);
  const [draft, setDraft] = useState<Record<Role, RoleTarget> | null>(null);
  const [savingRole, setSavingRole] = useState<Role | null>(null);
  const [successRole, setSuccessRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/role-targets");
    if (res.ok) {
      const data = await res.json();
      setRoles(data.roles);
      setRoleLabels(data.roleLabels);
      setTargets(data.targets);
      const d = Object.fromEntries(data.roles.map((r: Role) => [r, data.targets[r] ?? EMPTY_TARGET])) as Record<Role, RoleTarget>;
      setDraft(d);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  if (!targets || !draft) {
    return (
      <SectionCard title="Objetivo esperado del cargo">
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </SectionCard>
    );
  }

  async function saveRole(role: Role) {
    setSavingRole(role);
    setError(null);
    setSuccessRole(null);
    try {
      const res = await fetch("/api/settings/role-targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, target: draft![role] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al guardar");
      } else {
        setTargets(data.targets);
        setSuccessRole(role);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <SectionCard title="Objetivo esperado del cargo">
      <p className="text-xs text-secondary">
        Configuración opcional por cargo, usada únicamente como referencia en el Benchmark Personal cuando un cargo
        tiene pocos o ningún colaborador para comparar entre pares (§Sprint 7). Nunca modifica el cálculo de ningún
        KPI — si se deja en blanco, esa comparación simplemente no se muestra.
      </p>

      {error && (
        <div className="flex items-center justify-between bg-danger/[.09] text-danger text-sm px-3 py-2 rounded-lg">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-disabled uppercase tracking-wider border-b border-border">
              <th className="py-2 pr-3">Cargo</th>
              <th className="py-2 px-3">Performance esperado</th>
              <th className="py-2 px-3">Riesgo Operativo máximo</th>
              <th className="py-2 px-3">Cumplimiento esperado</th>
              <th className="py-2 pl-3"></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => {
              const value = draft[role] ?? EMPTY_TARGET;
              const dirty = JSON.stringify(targets[role] ?? EMPTY_TARGET) !== JSON.stringify(value);
              const setField = (field: keyof RoleTarget, v: string) =>
                setDraft((prev) => (prev ? { ...prev, [role]: { ...prev[role], [field]: fromInput(v) } } : prev));
              return (
                <tr key={role} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 text-title font-medium whitespace-nowrap">{roleLabels[role] ?? role}</td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="—"
                      value={toInput(value.performance)}
                      onChange={(e) => setField("performance", e.target.value)}
                      className="w-20 border border-border rounded-lg px-1.5 py-1 text-xs text-title bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="—"
                      value={toInput(value.riesgoMax)}
                      onChange={(e) => setField("riesgoMax", e.target.value)}
                      className="w-20 border border-border rounded-lg px-1.5 py-1 text-xs text-title bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="—"
                      value={toInput(value.cumplimiento)}
                      onChange={(e) => setField("cumplimiento", e.target.value)}
                      className="w-20 border border-border rounded-lg px-1.5 py-1 text-xs text-title bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <button
                      onClick={() => saveRole(role)}
                      disabled={savingRole === role || !dirty}
                      className="px-3 py-1.5 bg-primary text-white font-medium rounded-lg text-xs hover:bg-primary-hover disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {savingRole === role ? "Guardando…" : successRole === role && !dirty ? "Guardado ✓" : "Guardar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
