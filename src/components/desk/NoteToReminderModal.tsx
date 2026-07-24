"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import {
  REMINDER_PRIORITY_LABEL,
  REMINDER_PRIORITY_COLOR,
  type ReminderPriority,
  type DeskNote,
  type DeskNotePriority,
} from "./types";

const PRIORITIES: ReminderPriority[] = ["BAJA", "MEDIA", "ALTA", "URGENTE"];

// Misma escala 1:1 que el backend (ver /api/desk-notes/[id]/convert-to-reminder).
const PRIORITY_MAP: Record<DeskNotePriority, ReminderPriority> = {
  INFORMACION: "BAJA",
  RECORDATORIO: "MEDIA",
  IMPORTANTE: "ALTA",
  URGENTE: "URGENTE",
};

function defaultDateTime(): { date: string; time: string } {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

export default function NoteToReminderModal({
  note,
  onClose,
  onConverted,
}: {
  note: DeskNote;
  onClose: () => void;
  onConverted: (reminderId: string) => void;
}) {
  const initial = defaultDateTime();
  const [title, setTitle] = useState(note.message.length > 100 ? `${note.message.slice(0, 100)}…` : note.message);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [priority, setPriority] = useState<ReminderPriority>(PRIORITY_MAP[note.priority]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!date || !time) { setError("Fecha y hora son requeridas"); return; }
    setSaving(true);
    try {
      const dueAt = new Date(`${date}T${time}:00`).toISOString();
      const res = await fetch(`/api/desk-notes/${note.id}/convert-to-reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueAt, priority }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error al convertir la nota en recordatorio");
      else onConverted(data.reminderId);
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title="Convertir en Recordatorio" onClose={onClose} />
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <p className="text-xs text-secondary bg-background rounded-xl px-3 py-2 leading-relaxed">
            La nota de <strong>{note.senderName}</strong> permanecerá disponible en tu Escritorio, marcada como convertida.
          </p>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Fecha *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Hora *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
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

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-xl">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">
              {saving ? "Convirtiendo…" : "Crear recordatorio"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
    </Modal>
  );
}
