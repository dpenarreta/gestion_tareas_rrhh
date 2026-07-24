"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Modal, ModalHeader } from "@/components/ui/Modal";
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
  const { showToast } = useToast();
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
        showToast(reminder ? "Recordatorio actualizado." : "Recordatorio creado.", "success");
        onSaved();
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title={reminder ? "Editar recordatorio" : "Nuevo recordatorio"} onClose={onClose} />
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

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">
              {saving ? "Guardando…" : reminder ? "Guardar cambios" : "Crear recordatorio"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
    </Modal>
  );
}
