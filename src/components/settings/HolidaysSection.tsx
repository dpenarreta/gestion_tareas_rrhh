"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";

type Holiday = {
  id: string;
  date: string;
  name: string;
  year: number;
};

function formatHolidayDate(iso: string) {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

export default function HolidaysSection() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/holidays?year=${y}`);
      if (res.ok) setHolidays(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => load(year)); }, [load, year]);

  async function handleCreate() {
    if (!newDate || !newName.trim()) {
      setError("La fecha y el nombre del feriado son obligatorios");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/settings/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al agregar el feriado");
      } else {
        setNewDate("");
        setNewName("");
        if (data.year === year) setHolidays((prev) => [...prev, data].sort((a, b) => a.date.localeCompare(b.date)));
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(h: Holiday) {
    if (!confirm(`¿Eliminar el feriado "${h.name}" (${formatHolidayDate(h.date)})?`)) return;
    setBusyId(h.id);
    try {
      const res = await fetch(`/api/settings/holidays/${h.id}`, { method: "DELETE" });
      if (res.ok) setHolidays((prev) => prev.filter((x) => x.id !== h.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard title="Días feriados y calendario laboral">
      {error && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
        </div>
      )}
      <p className="text-xs text-secondary">
        Los feriados se excluyen del cálculo de días laborables junto a sábados y domingos.
      </p>

      <div className="flex flex-wrap items-end gap-2 border border-border rounded-lg p-3">
        <div className="space-y-1">
          <label className="block text-[10px] font-semibold text-secondary uppercase tracking-wide">Fecha</label>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-[180px]">
          <label className="block text-[10px] font-semibold text-secondary uppercase tracking-wide">Nombre del feriado</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='ej: "Día de la Independencia"'
            className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          {creating ? "Agregando…" : "Agregar feriado"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-secondary">Año:</label>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          className="border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : holidays.length === 0 ? (
          <p className="text-sm text-disabled text-center py-8">No hay feriados registrados para {year}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="text-left px-4 py-2.5 font-medium text-main">Fecha</th>
                <th className="text-left px-4 py-2.5 font-medium text-main">Nombre</th>
                <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2.5 text-title font-medium">{formatHolidayDate(h.date)}</td>
                  <td className="px-4 py-2.5 text-secondary">{h.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(h)}
                      disabled={busyId === h.id}
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
