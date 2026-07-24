"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import type { PersonalReminder } from "./types";

const FREQUENCY_OPTIONS = [
  { value: "PUNTUAL", label: "Puntual" },
  { value: "DIARIA", label: "Diaria" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
];

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ConvertReminderToTaskModal({
  reminder,
  onClose,
  onConverted,
}: {
  reminder: PersonalReminder;
  onClose: () => void;
  onConverted: (taskId: string) => void;
}) {
  const [title, setTitle] = useState(reminder.title);
  const [type, setType] = useState<"FIJA" | "SEGUIMIENTO">("SEGUIMIENTO");
  const [frequency, setFrequency] = useState("PUNTUAL");
  const [startDate, setStartDate] = useState(todayInput());
  const [endDate, setEndDate] = useState(plusDaysInput(7));
  const [estimatedHours, setEstimatedHours] = useState("1.00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("El título es requerido"); return; }
    if (!validateDisplayHours(estimatedHours)) { setError(INVALID_HOURS_MESSAGE); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/desk-reminders/${reminder.id}/convert-to-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type,
          frequency,
          startDate,
          endDate,
          estimatedHours: displayToHours(estimatedHours),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error al convertir el recordatorio en tarea");
      else onConverted(data.taskId);
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-title">Crear tarea</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <p className="text-xs text-secondary bg-background rounded-xl px-3 py-2 leading-relaxed">
            El recordatorio permanecerá disponible para fines de auditoría, marcado como convertido.
          </p>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Clasificación</label>
            <div className="grid grid-cols-2 gap-2">
              {(["FIJA", "SEGUIMIENTO"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    type === t ? "border-primary bg-primary-surface text-primary" : "border-border text-main hover:border-border2"
                  }`}
                >
                  {t === "FIJA" ? "Fija" : "Seguimiento"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Frecuencia</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Fecha inicio *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Fecha fin *</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Tiempo objetivo *</label>
            <input
              type="text"
              inputMode="decimal"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              placeholder="ej: 1.00 = 1h"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-xl">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">
              {saving ? "Creando…" : "Crear tarea"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
