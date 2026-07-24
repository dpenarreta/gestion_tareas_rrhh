"use client";

import { useState, useEffect } from "react";
import type { Task, AssignableUser, TaskType } from "./types";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import { TARGET_TIME_TOOLTIP } from "@/lib/targetTime";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Clipboard, Clock } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "EN_PROGRESO", label: "En Progreso" },
  { value: "COMPLETADA", label: "Completada" },
];

const PRIORITY_OPTIONS = [
  { value: "ALTA", label: "Alta" },
  { value: "MEDIA", label: "Media" },
  { value: "BAJA", label: "Baja" },
];

const FREQUENCY_OPTIONS = [
  { value: "MENSUAL", label: "Mensual" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "DIARIA", label: "Diaria" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "PUNTUAL", label: "Puntual" },
];

function toInputDate(iso: string) {
  return iso.split("T")[0];
}

type Props = {
  task: Task | null;
  initialStatus: Task["status"];
  initialAssignedToId?: string;
  users: AssignableUser[];
  currentUserId: string;
  onSave: () => void;
  onClose: () => void;
};

export default function TaskFormModal({ task, initialStatus, initialAssignedToId, users, currentUserId, onSave, onClose }: Props) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("FIJA");
  const [status, setStatus] = useState<Task["status"]>(initialStatus);
  const [priority, setPriority] = useState<Task["priority"]>("MEDIA");
  const [frequency, setFrequency] = useState<Task["frequency"]>("MENSUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [assignedToId, setAssignedToId] = useState(initialAssignedToId ?? currentUserId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      if (task) {
        setTitle(task.title);
        setDescription(task.description ?? "");
        setType(task.type);
        setStatus(task.status);
        setPriority(task.priority);
        setFrequency(task.frequency);
        setStartDate(toInputDate(task.startDate));
        setEndDate(toInputDate(task.endDate));
        setEstimatedHours(hoursToDisplay(task.estimatedHours));
        setAssignedToId(task.assignedTo.id);
      }
    });
  }, [task]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("El título es requerido"); return; }
    if (!startDate || !endDate) { setError("Las fechas son requeridas"); return; }
    if (!estimatedHours) { setError("El tiempo objetivo es requerido"); return; }
    if (!validateDisplayHours(estimatedHours)) { setError(INVALID_HOURS_MESSAGE); return; }

    setSaving(true);
    setError("");

    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        type,
        status,
        priority,
        frequency,
        startDate,
        endDate,
        estimatedHours: displayToHours(estimatedHours),
        assignedToId,
      };

      const url = task ? `/api/tasks/${task.id}` : "/api/tasks";
      const method = task ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Error al guardar");
        return;
      }

      showToast(task ? "Tarea actualizada." : "Tarea creada.", "success");
      onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title={task ? "Editar tarea" : "Nueva tarea"} onClose={onClose} />

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-danger bg-danger/[.09] border border-transparent rounded-lg px-4 py-2.5">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Nombre de la tarea"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              rows={3}
              placeholder="Descripción opcional"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Clasificación</label>
            <div className="grid grid-cols-2 gap-2">
              {(["FIJA", "SEGUIMIENTO"] as TaskType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    type === t
                      ? t === "FIJA"
                        ? "border-border2 bg-surface2 text-title"
                        : "border-primary bg-primary-surface text-primary"
                      : "border-border text-main hover:border-border"
                  }`}
                >
                  {t === "FIJA" ? (
                    <Clipboard className="w-4 h-4 shrink-0" strokeWidth={2} />
                  ) : (
                    <Clock className="w-4 h-4 shrink-0" strokeWidth={2} />
                  )}
                  {t === "FIJA" ? "Fija" : "Seguimiento"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Estado</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Task["status"])}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Prioridad *</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task["priority"])}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Frecuencia *</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Task["frequency"])}
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
            <label className="block text-xs font-semibold text-main mb-1.5 flex items-center gap-1.5">
              Tiempo objetivo *
              <InfoTooltip text={TARGET_TIME_TOOLTIP} />
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="ej: 6.30 = 6h 30min"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Asignado a *</label>
            <select
              value={assignedToId}
              onChange={(e) => setAssignedToId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : task ? "Actualizar" : "Crear tarea"}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
