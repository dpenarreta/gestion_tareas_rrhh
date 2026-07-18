"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "./SectionCard";

type SimpleUser = { id: string; name: string; email: string; role: Role };

type SpecialStatusType = "MATERNIDAD" | "LACTANCIA";

type SpecialStatusRecord = {
  id: string;
  userId: string;
  type: SpecialStatusType;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  user: { id: string; name: string };
};

const TYPE_LABEL: Record<SpecialStatusType, string> = {
  MATERNIDAD: "👶 Maternidad",
  LACTANCIA: "👶 Lactancia",
};

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

  async function handleCreate() {
    if (!formUserId || !formStartDate) {
      setError("El usuario y la fecha de inicio son obligatorios");
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
        Mientras esté vigente, la base diaria de KPI de la persona se reduce a 6h (en vez de las horas efectivas
        configuradas globalmente), con rangos: Subutilización &lt;5h, Moderado 5-6h, Óptimo 6-7h, Elevada 7-8h,
        Sobrecarga &gt;8h. La base semanal/mensual se ajusta proporcionalmente por los días que caigan dentro del
        período.
      </p>

      <div className="space-y-2 border border-border rounded-lg p-3">
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

        <div className="flex justify-end pt-1">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {creating ? "Registrando…" : "Registrar estado especial"}
          </button>
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
