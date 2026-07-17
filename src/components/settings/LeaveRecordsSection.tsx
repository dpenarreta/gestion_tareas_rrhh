"use client";

import { useState, useEffect, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "./SectionCard";

type SimpleUser = { id: string; name: string; email: string; role: Role };

type LeaveRecord = {
  id: string;
  userId: string;
  type: "MEDICO" | "PERSONAL";
  date: string;
  isFullDay: boolean;
  durationMinutes: number | null;
  observation: string | null;
  user: { id: string; name: string };
};

const TYPE_LABEL: Record<LeaveRecord["type"], string> = {
  MEDICO: "🏥 Permiso médico",
  PERSONAL: "📋 Permiso personal",
};

function formatLeaveDate(iso: string) {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function clampInt(value: string, min: number, max: number): string {
  if (value === "") return "";
  const n = Math.trunc(Number(value));
  if (Number.isNaN(n)) return "";
  return String(Math.min(max, Math.max(min, n)));
}

export default function LeaveRecordsSection({ users }: { users: SimpleUser[] }) {
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterMonth, setFilterMonth] = useState(currentMonthParam());

  const [formUserId, setFormUserId] = useState("");
  const [formType, setFormType] = useState<LeaveRecord["type"]>("MEDICO");
  const [formDate, setFormDate] = useState("");
  const [formFullDay, setFormFullDay] = useState(true);
  const [formHours, setFormHours] = useState("");
  const [formMinutes, setFormMinutes] = useState("");
  const [formObservation, setFormObservation] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (userId: string, month: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userId) params.set("userId", userId);
      if (month) params.set("month", month);
      const res = await fetch(`/api/settings/leave-records?${params.toString()}`);
      if (res.ok) setRecords(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => load(filterUserId, filterMonth)); }, [load, filterUserId, filterMonth]);

  async function handleCreate() {
    if (!formUserId || !formDate) {
      setError("El usuario y la fecha son obligatorios");
      return;
    }
    const durationMinutes = Number(formHours || 0) * 60 + Number(formMinutes || 0);
    if (!formFullDay && durationMinutes <= 0) {
      setError("Ingresa la duración del permiso parcial");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/settings/leave-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: formUserId,
          type: formType,
          date: formDate,
          isFullDay: formFullDay,
          durationMinutes: formFullDay ? undefined : durationMinutes,
          observation: formObservation.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al registrar el permiso");
      } else {
        setFormDate("");
        setFormHours("");
        setFormMinutes("");
        setFormObservation("");
        await load(filterUserId, filterMonth);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(r: LeaveRecord) {
    if (!confirm(`¿Eliminar el permiso de ${r.user.name} del ${formatLeaveDate(r.date)}?`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/settings/leave-records/${r.id}`, { method: "DELETE" });
      if (res.ok) setRecords((prev) => prev.filter((x) => x.id !== r.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard title="Permisos del personal">
      {error && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
        </div>
      )}

      <div className="space-y-2 border border-border rounded-lg p-3">
        <p className="text-sm font-medium text-title">Registrar permiso</p>
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
            onChange={(e) => setFormType(e.target.value as LeaveRecord["type"])}
            className="border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="MEDICO">Permiso médico</option>
            <option value="PERSONAL">Permiso personal</option>
          </select>
          <input
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <label className="flex items-center gap-2 text-sm text-title cursor-pointer">
            <input
              type="checkbox"
              checked={formFullDay}
              onChange={(e) => setFormFullDay(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            Día completo
          </label>
        </div>

        {!formFullDay && (
          <div className="grid grid-cols-2 gap-2 max-w-xs">
            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Horas</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={23}
                value={formHours}
                onChange={(e) => setFormHours(clampInt(e.target.value, 0, 23))}
                placeholder="0"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Minutos</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={formMinutes}
                onChange={(e) => setFormMinutes(clampInt(e.target.value, 0, 59))}
                placeholder="0"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}

        <input
          type="text"
          value={formObservation}
          onChange={(e) => setFormObservation(e.target.value)}
          placeholder="Observación (opcional)"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />

        <div className="flex justify-end pt-1">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {creating ? "Registrando…" : "Registrar permiso"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="block text-[10px] font-semibold text-secondary uppercase tracking-wide">Usuario</label>
          <select
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-semibold text-secondary uppercase tracking-wide">Mes</label>
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <p className="text-sm text-disabled text-center py-8">No hay permisos registrados con estos filtros.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="text-left px-4 py-2.5 font-medium text-main">Usuario</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Tipo</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Fecha</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Duración</th>
                <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-title font-medium">{r.user.name}</td>
                  <td className="px-4 py-2.5 text-secondary">{TYPE_LABEL[r.type]}</td>
                  <td className="px-4 py-2.5 text-secondary">{formatLeaveDate(r.date)}</td>
                  <td className="px-4 py-2.5 text-secondary">
                    {r.isFullDay ? "Día completo" : `${Math.floor((r.durationMinutes ?? 0) / 60)}h ${(r.durationMinutes ?? 0) % 60}min`}
                    {r.observation && <span className="block text-[11px] text-disabled max-w-xs truncate" title={r.observation}>{r.observation}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(r)}
                      disabled={busyId === r.id}
                      className="text-xs text-danger hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-danger/[.09] transition-colors disabled:opacity-50"
                    >
                      🗑️ Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );
}
