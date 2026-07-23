"use client";

import { useState } from "react";
import {
  REMINDER_PRIORITY_LABEL,
  REMINDER_PRIORITY_COLOR,
  REMINDER_REPEAT_LABEL,
  type ReminderPriority,
  type ReminderRepeat,
  type PersonalReminder,
} from "./types";

const PRIORITIES: ReminderPriority[] = ["BAJA", "MEDIA", "ALTA", "URGENTE"];
const REPEATS: ReminderRepeat[] = ["UNA_VEZ", "DIARIO", "SEMANAL", "MENSUAL"];

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

function defaultDateTime(): { date: string; time: string } {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return splitDateTime(d.toISOString());
}

export default function NewReminderModal({
  reminder,
  onClose,
  onSaved,
}: {
  reminder?: PersonalReminder | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = reminder ? splitDateTime(reminder.dueAt) : defaultDateTime();
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [description, setDescription] = useState(reminder?.description ?? "");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [priority, setPriority] = useState<ReminderPriority>(reminder?.priority ?? "MEDIA");
  const [repeat, setRepeat] = useState<ReminderRepeat>(reminder?.repeat ?? "UNA_VEZ");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("El título es requerido"); return; }
    if (!date || !time) { setError("Fecha y hora son requeridas"); return; }
    setSaving(true);
    try {
      const dueAt = new Date(`${date}T${time}:00`).toISOString();
      const url = reminder ? `/api/desk-reminders/${reminder.id}` : "/api/desk-reminders";
      const method = reminder ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, dueAt, priority, repeat }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Error al guardar el recordatorio");
      } else {
        onSaved();
      }
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
          <h2 className="text-base font-semibold text-title">{reminder ? "Editar recordatorio" : "Nuevo recordatorio"}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Llamar a Finanzas"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Descripción</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalle opcional"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Fecha *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Hora *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Prioridad</label>
            <div className="grid grid-cols-2 gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${
                    priority === p ? "border-primary bg-primary-surface text-primary" : "border-border text-main hover:border-primary/40"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: REMINDER_PRIORITY_COLOR[p] }} />
                  {REMINDER_PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Repetición</label>
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {REPEATS.map((r) => (
                <option key={r} value={r}>{REMINDER_REPEAT_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-xl">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? "Guardando…" : reminder ? "Guardar cambios" : "Crear recordatorio"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
