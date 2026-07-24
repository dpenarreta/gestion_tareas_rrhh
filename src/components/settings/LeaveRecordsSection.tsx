"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";

type SimpleUser = { id: string; name: string; email: string; role: Role };

type LeaveRecord = {
  id: string;
  userId: string;
  type: "MEDICO" | "PERSONAL" | "VACACIONES";
  date: string;
  isFullDay: boolean;
  durationMinutes: number | null;
  observation: string | null;
  user: { id: string; name: string };
};

const TYPE_LABEL: Record<LeaveRecord["type"], string> = {
  MEDICO: "🏥 Permiso médico",
  PERSONAL: "📋 Permiso personal",
  VACACIONES: "🌴 Vacaciones",
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

/** "YYYY-MM-DD" (de un <input type="date">) -> Date UTC-medianoche, para contar días laborables igual que el servidor. */
function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countBusinessDays(start: Date, end: Date, holidays: Set<number>): number {
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(t)) count++;
  }
  return count;
}

export default function LeaveRecordsSection({ users }: { users: SimpleUser[] }) {
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterMonth, setFilterMonth] = useState(currentMonthParam());
  const [holidays, setHolidays] = useState<Set<number>>(new Set());

  const [formUserId, setFormUserId] = useState("");
  const [formType, setFormType] = useState<LeaveRecord["type"]>("MEDICO");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formFullDay, setFormFullDay] = useState(true);
  const [formHours, setFormHours] = useState("");
  const [formMinutes, setFormMinutes] = useState("");
  const [formObservation, setFormObservation] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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

  useEffect(() => {
    queueMicrotask(async () => {
      const res = await fetch("/api/settings/holidays");
      if (res.ok) {
        const data: { date: string }[] = await res.json();
        setHolidays(new Set(data.map((h) => new Date(h.date).getTime())));
      }
    });
  }, []);

  const businessDaysPreview = useMemo(() => {
    const start = parseDateOnly(formStartDate);
    const end = parseDateOnly(formEndDate);
    if (!start || !end || end < start) return null;
    return countBusinessDays(start, end, holidays);
  }, [formStartDate, formEndDate, holidays]);

  async function handleCreate() {
    if (!formUserId || !formStartDate || !formEndDate) {
      setError("El usuario y el rango de fechas son obligatorios");
      return;
    }
    const effectiveFullDay = formType === "VACACIONES" ? true : formFullDay;
    const durationMinutes = Number(formHours || 0) * 60 + Number(formMinutes || 0);
    if (!effectiveFullDay && durationMinutes <= 0) {
      setError("Ingresa la duración del permiso parcial");
      return;
    }
    setError(null);
    setMsg(null);
    setCreating(true);
    try {
      const res = await fetch("/api/settings/leave-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: formUserId,
          type: formType,
          startDate: formStartDate,
          endDate: formEndDate,
          isFullDay: effectiveFullDay,
          durationMinutes: effectiveFullDay ? undefined : durationMinutes,
          observation: formObservation.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al registrar el permiso");
      } else {
        setMsg(
          `Permiso registrado: ${data.businessDaysCount} ${data.businessDaysCount === 1 ? "día laborable" : "días laborables"}.`
        );
        setFormStartDate("");
        setFormEndDate("");
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
            onChange={(e) => {
              const nextType = e.target.value as LeaveRecord["type"];
              setFormType(nextType);
              if (nextType === "VACACIONES") setFormFullDay(true);
            }}
            className="border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="MEDICO">Permiso médico</option>
            <option value="PERSONAL">Permiso personal</option>
            <option value="VACACIONES">Vacaciones</option>
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
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fecha fin</label>
            <input
              type="date"
              value={formEndDate}
              onChange={(e) => setFormEndDate(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {formType !== "VACACIONES" && (
          <label className="flex items-center gap-2 text-sm text-title cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={formFullDay}
              onChange={(e) => setFormFullDay(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            Día completo
          </label>
        )}

        {!formFullDay && formType !== "VACACIONES" && (
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

        {businessDaysPreview !== null && (
          <p className={`text-xs rounded-lg px-3 py-2 ${businessDaysPreview > 0 ? "bg-primary-surface text-primary" : "bg-danger/[.09] text-danger"}`}>
            {businessDaysPreview > 0
              ? `Este permiso cubre ${businessDaysPreview} ${businessDaysPreview === 1 ? "día laborable" : "días laborables"}.`
              : "El rango seleccionado no incluye días laborables (excluye fines de semana y feriados)."}
          </p>
        )}

        <input
          type="text"
          value={formObservation}
          onChange={(e) => setFormObservation(e.target.value)}
          placeholder="Observación (opcional)"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />

        <div className="flex justify-end pt-1">
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Registrando…" : "Registrar permiso"}
          </Button>
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
