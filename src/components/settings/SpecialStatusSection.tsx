"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";

type SimpleUser = { id: string; name: string; email: string; role: Role };

type SpecialStatusType = "MATERNIDAD" | "LACTANCIA";

type SpecialStatusRecord = {
  id: string;
  userId: string;
  type: SpecialStatusType;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  dailyHours: number;
  limitLow: number;
  limitBase: number;
  limitHigh: number;
  limitOverload: number;
  user: { id: string; name: string };
};

const TYPE_LABEL: Record<SpecialStatusType, string> = {
  MATERNIDAD: "👶 Maternidad",
  LACTANCIA: "👶 Lactancia",
};

const DEFAULT_DAILY_HOURS_INPUT = "6.00";
const DEFAULT_LIMIT_LOW_INPUT = "5.00";
const DEFAULT_LIMIT_BASE_INPUT = "6.00";
const DEFAULT_LIMIT_HIGH_INPUT = "7.00";
const DEFAULT_LIMIT_OVERLOAD_INPUT = "8.00";

function formatDate(iso: string) {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

function utcTodayMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function isFinalizado(r: SpecialStatusRecord): boolean {
  if (!r.isActive) return true;
  if (r.endDate && new Date(r.endDate).getTime() < utcTodayMidnight()) return true;
  return false;
}

export default function SpecialStatusSection({ users }: { users: SimpleUser[] }) {
  const [records, setRecords] = useState<SpecialStatusRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [formUserId, setFormUserId] = useState("");
  const [formType, setFormType] = useState<SpecialStatusType>("MATERNIDAD");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [dailyHoursInput, setDailyHoursInput] = useState(DEFAULT_DAILY_HOURS_INPUT);
  const [limitLowInput, setLimitLowInput] = useState(DEFAULT_LIMIT_LOW_INPUT);
  const [limitBaseInput, setLimitBaseInput] = useState(DEFAULT_LIMIT_BASE_INPUT);
  const [limitHighInput, setLimitHighInput] = useState(DEFAULT_LIMIT_HIGH_INPUT);
  const [limitOverloadInput, setLimitOverloadInput] = useState(DEFAULT_LIMIT_OVERLOAD_INPUT);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/special-status");
      if (res.ok) setRecords(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const limitInputsValid =
    validateDisplayHours(dailyHoursInput) &&
    validateDisplayHours(limitLowInput) &&
    validateDisplayHours(limitBaseInput) &&
    validateDisplayHours(limitHighInput) &&
    validateDisplayHours(limitOverloadInput);

  const limitLowPreview = limitInputsValid ? displayToHours(limitLowInput) : null;
  const limitBasePreview = limitInputsValid ? displayToHours(limitBaseInput) : null;
  const limitHighPreview = limitInputsValid ? displayToHours(limitHighInput) : null;
  const limitOverloadPreview = limitInputsValid ? displayToHours(limitOverloadInput) : null;
  const limitOrderValid =
    limitLowPreview !== null &&
    limitBasePreview !== null &&
    limitHighPreview !== null &&
    limitOverloadPreview !== null &&
    limitLowPreview < limitBasePreview &&
    limitBasePreview <= limitHighPreview &&
    limitHighPreview < limitOverloadPreview;

  function resetLimitInputs() {
    setDailyHoursInput(DEFAULT_DAILY_HOURS_INPUT);
    setLimitLowInput(DEFAULT_LIMIT_LOW_INPUT);
    setLimitBaseInput(DEFAULT_LIMIT_BASE_INPUT);
    setLimitHighInput(DEFAULT_LIMIT_HIGH_INPUT);
    setLimitOverloadInput(DEFAULT_LIMIT_OVERLOAD_INPUT);
  }

  async function handleCreate() {
    if (!formUserId || !formStartDate) {
      setError("El usuario y la fecha de inicio son obligatorios");
      return;
    }
    if (!limitInputsValid) {
      setError(INVALID_HOURS_MESSAGE);
      return;
    }
    if (!limitOrderValid) {
      setError("Los límites deben cumplir: Subutilización < Moderado/Óptimo ≤ Óptimo/Elevada < Elevada/Sobrecarga");
      return;
    }
    setError(null);
    setMsg(null);
    setCreating(true);
    try {
      const res = await fetch("/api/settings/special-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: formUserId,
          type: formType,
          startDate: formStartDate,
          endDate: formEndDate || undefined,
          dailyHours: displayToHours(dailyHoursInput),
          limitLow: displayToHours(limitLowInput),
          limitBase: displayToHours(limitBaseInput),
          limitHigh: displayToHours(limitHighInput),
          limitOverload: displayToHours(limitOverloadInput),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al registrar el estado especial");
      } else {
        setMsg(`Estado especial activado para ${data.user.name} desde ${formatDate(data.startDate)}.`);
        setFormUserId("");
        setFormStartDate("");
        setFormEndDate("");
        resetLimitInputs();
        await load();
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  async function handleFinalize(r: SpecialStatusRecord) {
    if (!confirm(`¿Finalizar el estado de ${TYPE_LABEL[r.type]} de ${r.user.name} hoy?`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/settings/special-status/${r.id}`, { method: "PATCH" });
      if (res.ok) {
        const updated = await res.json();
        setRecords((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(r: SpecialStatusRecord) {
    if (!confirm(`¿Eliminar el registro de ${TYPE_LABEL[r.type]} de ${r.user.name}? Esta acción no se puede deshacer.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/settings/special-status/${r.id}`, { method: "DELETE" });
      if (res.ok) setRecords((prev) => prev.filter((x) => x.id !== r.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard title="Estados especiales de personal">
      {msg && (
        <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="ml-2 text-success hover:brightness-90 font-bold">×</button>
        </div>
      )}
      {error && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
        </div>
      )}

      <p className="text-xs text-secondary">
        Mientras esté vigente, la base y los límites del semáforo de KPI de la persona se reemplazan por los
        configurados aquí (en vez de las horas efectivas/límites globales), ajustados proporcionalmente en las
        vistas semanal y mensual según los días que caigan dentro del período.
      </p>

      <div className="space-y-3 border border-border rounded-lg p-3">
        <p className="text-sm font-medium text-title">Registrar estado especial</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={formUserId}
            onChange={(e) => setFormUserId(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Selecciona un usuario…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value as SpecialStatusType)}
            className="border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="MATERNIDAD">Maternidad</option>
            <option value="LACTANCIA">Lactancia</option>
          </select>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fecha inicio</label>
            <input
              type="date"
              value={formStartDate}
              onChange={(e) => setFormStartDate(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fecha fin (opcional)</label>
            <input
              type="date"
              value={formEndDate}
              onChange={(e) => setFormEndDate(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[10px] text-disabled mt-1">Déjala vacía si el período está en curso.</p>
          </div>
        </div>

        <div className="pt-2 border-t border-border space-y-2">
          <p className="text-xs font-medium text-title">Base y límites del semáforo para esta persona</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-title block">Base de horas diarias</label>
              <input
                type="text"
                inputMode="decimal"
                value={dailyHoursInput}
                onChange={(e) => setDailyHoursInput(e.target.value)}
                placeholder="6.00"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-title block">Límite Subutilización / Moderado</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitLowInput}
                onChange={(e) => setLimitLowInput(e.target.value)}
                placeholder="5.00"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-title block">Límite Moderado / Óptimo</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitBaseInput}
                onChange={(e) => setLimitBaseInput(e.target.value)}
                placeholder="6.00"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-title block">Límite Óptimo / Carga elevada</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitHighInput}
                onChange={(e) => setLimitHighInput(e.target.value)}
                placeholder="7.00"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-title block">Límite Carga elevada / Sobrecarga</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitOverloadInput}
                onChange={(e) => setLimitOverloadInput(e.target.value)}
                placeholder="8.00"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {!limitInputsValid ? (
            <p className="text-xs text-danger">{INVALID_HOURS_MESSAGE}</p>
          ) : !limitOrderValid ? (
            <div className="rounded-lg bg-danger/[.09] border border-danger/30 px-4 py-3 text-sm text-danger">
              Los límites deben cumplir: Subutilización &lt; Moderado/Óptimo ≤ Óptimo/Elevada &lt; Elevada/Sobrecarga.
            </div>
          ) : (
            <div className="rounded-lg bg-background border border-border px-4 py-3 space-y-1.5 text-sm text-secondary">
              <p className="font-medium text-title">Rangos resultantes:</p>
              <p>🔴 Subutilización: menos de <span className="font-medium text-title">{hoursToDisplay(limitLowPreview!)}</span></p>
              <p>🟡 Rendimiento moderado: de <span className="font-medium text-title">{hoursToDisplay(limitLowPreview!)}</span> a <span className="font-medium text-title">{hoursToDisplay(limitBasePreview!)}</span></p>
              <p>🟢 Rango óptimo: de <span className="font-medium text-title">{hoursToDisplay(limitBasePreview!)}</span> a <span className="font-medium text-title">{hoursToDisplay(limitHighPreview!)}</span></p>
              <p>🟠 Carga elevada: de <span className="font-medium text-title">{hoursToDisplay(limitHighPreview!)}</span> a <span className="font-medium text-title">{hoursToDisplay(limitOverloadPreview!)}</span></p>
              <p>🔴 Sobrecarga: más de <span className="font-medium text-title">{hoursToDisplay(limitOverloadPreview!)}</span></p>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Registrando…" : "Registrar estado especial"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <p className="text-sm text-disabled text-center py-8">No hay estados especiales registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="text-left px-4 py-2.5 font-medium text-main">Usuario</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Tipo</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Fecha inicio</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Fecha fin</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Base / límites</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Estado</th>
                <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r) => {
                const finalizado = isFinalizado(r);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 text-title font-medium">{r.user.name}</td>
                    <td className="px-4 py-2.5 text-secondary">{TYPE_LABEL[r.type]}</td>
                    <td className="px-4 py-2.5 text-secondary">{formatDate(r.startDate)}</td>
                    <td className="px-4 py-2.5 text-secondary">{r.endDate ? formatDate(r.endDate) : "En curso"}</td>
                    <td className="px-4 py-2.5 text-secondary text-xs">
                      {hoursToDisplay(r.dailyHours)}h base · {hoursToDisplay(r.limitLow)}/{hoursToDisplay(r.limitBase)}/
                      {hoursToDisplay(r.limitHigh)}/{hoursToDisplay(r.limitOverload)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          finalizado ? "bg-surface2 text-secondary" : "bg-success/[.13] text-success"
                        }`}
                      >
                        {finalizado ? "Finalizado" : "Activo"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap">
                      {!finalizado && (
                        <button
                          onClick={() => handleFinalize(r)}
                          disabled={busyId === r.id}
                          className="text-xs text-warning hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-warning/[.15] transition-colors disabled:opacity-50"
                        >
                          Finalizar
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={busyId === r.id}
                        className="text-xs text-danger hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-danger/[.09] transition-colors disabled:opacity-50"
                      >
                        🗑️ Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );
}
