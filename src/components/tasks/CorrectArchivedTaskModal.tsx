"use client";

import { useState } from "react";
import type { Task, TaskStatus } from "./types";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Modal, ModalHeader } from "@/components/ui/Modal";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "EN_PROGRESO", label: "En Progreso" },
  { value: "COMPLETADA", label: "Completada" },
];

type Props = {
  task: Task;
  onClose: () => void;
  onSaved: (updated: Task) => void;
};

export default function CorrectArchivedTaskModal({ task, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [realHours, setRealHours] = useState(hoursToDisplay(task.realHours));
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!validateDisplayHours(realHours)) {
      setError(INVALID_HOURS_MESSAGE);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/correct`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realHours: displayToHours(realHours), status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al guardar la corrección");
        return;
      }
      showToast("Tarea corregida.", "success");
      onSaved(data);
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="✏️ Corregir tarea archivada" onClose={onClose} />

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-main truncate">{task.title}</p>

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1 uppercase tracking-wide">
              Horas reales
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={realHours}
              onChange={(e) => setRealHours(e.target.value)}
              placeholder="ej: 6.30 = 6h 30min"
              className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1 uppercase tracking-wide">
              Estado final
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger/[.09] rounded-xl px-4 py-2.5">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar corrección"}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
