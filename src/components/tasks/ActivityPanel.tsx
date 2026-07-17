"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Task, TaskActivity, FollowUpReminder } from "./types";
import TimeInput24 from "@/components/ui/TimeInput24";
import type { ActivityFormat } from "@/lib/activityFormat";
import { fetchActivityReasons, selectableReasons, formatDuration, type ActivityReasonConfig } from "./activityReasons";
import { rangesOverlap } from "@/lib/timeOverlap";
import ActivityItem from "./ActivityItem";

type DayScheduleEntry = { id: string; startTime: string; endTime: string; taskId: string; taskTitle: string };

function formatReminderDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${mins}`;
}

function clampInt(value: string, min: number, max: number): string {
  if (value === "") return "";
  const n = Math.trunc(Number(value));
  if (Number.isNaN(n)) return "";
  return String(Math.min(max, Math.max(min, n)));
}

function timeToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type Props = {
  task: Task;
  currentUserId: string;
  currentUserRole?: Role;
  onClose: () => void;
  readOnly?: boolean;
  activityFormat?: ActivityFormat;
};

export default function ActivityPanel({ task, currentUserId, currentUserRole, onClose, readOnly = false, activityFormat = "duration" }: Props) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [reasons, setReasons] = useState<ActivityReasonConfig[]>([]);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");
  const [daySchedule, setDaySchedule] = useState<DayScheduleEntry[]>([]);

  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);
  const [remindersExpanded, setRemindersExpanded] = useState(true);
  const remindersDefaultSetRef = useRef(false);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [reminderDescription, setReminderDescription] = useState("");
  const [reminderSubmitting, setReminderSubmitting] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const rangeError = useMemo(() => {
    if (activityFormat !== "timerange") return "";
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    if (startMins === null || endMins === null) return "";
    if (endMins < startMins) return "La hora fin debe ser posterior a la hora inicio";
    return "";
  }, [activityFormat, startTime, endTime]);

  const overlapConflict = useMemo(() => {
    if (activityFormat !== "timerange" || rangeError || !startTime || !endTime) return null;
    return daySchedule.find((a) => rangesOverlap(startTime, endTime, a.startTime, a.endTime)) ?? null;
  }, [activityFormat, rangeError, startTime, endTime, daySchedule]);

  const overlapError = overlapConflict
    ? `Este horario se superpone con una actividad registrada de ${overlapConflict.startTime} a ${overlapConflict.endTime} en la tarea "${overlapConflict.taskTitle}". Por favor ajusta el horario.`
    : "";

  const previewDuration = useMemo(() => {
    if (activityFormat === "timerange") {
      const startMins = timeToMinutes(startTime);
      const endMins = timeToMinutes(endTime);
      if (startMins === null || endMins === null) return null;
      const total = endMins - startMins;
      return total > 0 ? total : null;
    }
    const h = Number(hours) || 0;
    const m = Number(minutes) || 0;
    const total = h * 60 + m;
    return total > 0 ? total : null;
  }, [activityFormat, hours, minutes, startTime, endTime]);

  const totalMinutes = useMemo(
    () => activities.reduce((sum, a) => sum + a.duration, 0),
    [activities]
  );

  useEffect(() => {
    fetch(`/api/tasks/${task.id}/activities`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setActivities(Array.isArray(data) ? data : []))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, [task.id]);

  useEffect(() => {
    fetchActivityReasons().then(setReasons);
  }, []);

  useEffect(() => {
    if (readOnly || activityFormat !== "timerange") return;
    fetch("/api/activities/day-schedule")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDaySchedule(Array.isArray(data) ? data : []))
      .catch(() => setDaySchedule([]));
  }, [readOnly, activityFormat]);

  const selectable = useMemo(() => selectableReasons(reasons, currentUserRole), [reasons, currentUserRole]);
  // Sin sync-effect: mientras el usuario no elija explícitamente, el motivo
  // efectivo es el primero disponible una vez que la lista carga.
  const effectiveReason = reason || selectable[0]?.key || "";

  useEffect(() => {
    if (readOnly) return;
    fetch(`/api/reminders?taskId=${task.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list: FollowUpReminder[] = Array.isArray(data) ? data : [];
        setReminders(list);
        if (!remindersDefaultSetRef.current) {
          setRemindersExpanded(list.length <= 3);
          remindersDefaultSetRef.current = true;
        }
      })
      .catch(() => setReminders([]));
  }, [task.id, readOnly]);

  async function submitReminder() {
    if (!reminderTitle.trim() || !reminderDate || !reminderTime || reminderSubmitting) return;
    setReminderError("");
    setReminderSubmitting(true);
    try {
      const reminderAt = new Date(`${reminderDate}T${reminderTime}:00`).toISOString();
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          title: reminderTitle.trim(),
          description: reminderDescription.trim() || null,
          reminderAt,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setReminders((prev) => [...prev, created].sort((a, b) => a.reminderAt.localeCompare(b.reminderAt)));
        setReminderTitle("");
        setReminderDate("");
        setReminderTime("");
        setReminderDescription("");
        setShowReminderForm(false);
      } else {
        let msg = "Error al crear el recordatorio";
        try {
          const data = await res.json();
          msg = data.error ?? msg;
        } catch { /* respuesta sin body */ }
        setReminderError(msg);
      }
    } finally {
      setReminderSubmitting(false);
    }
  }

  async function handleDeleteReminder(id: string) {
    setDeletingReminderId(id);
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== id));
      }
    } finally {
      setDeletingReminderId(null);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  async function submit() {
    if (submitting) return;
    if (!effectiveReason) {
      setError("Selecciona un motivo");
      return;
    }
    if (!previewDuration) {
      setError("La duración debe ser mayor a 0");
      return;
    }
    if (overlapConflict) {
      setError(overlapError);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const h = Math.floor(previewDuration / 60);
      const m = previewDuration % 60;
      const res = await fetch(`/api/tasks/${task.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: effectiveReason,
          hours: h,
          minutes: m,
          description: description.trim() || null,
          ...(activityFormat === "timerange" ? { startTime, endTime } : {}),
        }),
      });
      if (res.ok) {
        const activity = await res.json();
        setActivities((prev) => [...prev, activity]);
        if (activityFormat === "timerange" && activity.startTime && activity.endTime) {
          setDaySchedule((prev) => [
            ...prev,
            { id: activity.id, startTime: activity.startTime, endTime: activity.endTime, taskId: task.id, taskTitle: task.title },
          ]);
        }
        setHours("");
        setMinutes("");
        setStartTime("");
        setEndTime("");
        setDescription("");
        setReason(selectable[0]?.key ?? "");
      } else {
        let msg = "Error al registrar";
        try {
          const data = await res.json();
          msg = data.error ?? msg;
        } catch { /* respuesta sin body */ }
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleActivityDeleted(activityId: string) {
    setActivities((prev) => prev.filter((a) => a.id !== activityId));
  }

  function handleActivityUpdated(updated: TaskActivity) {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-border shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-title text-sm truncate">{task.title}</h3>
            <p className="text-xs text-secondary">{readOnly ? "Actividades de seguimiento" : "Registro de actividades"}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Total summary */}
        {totalMinutes > 0 && (
          <div className="px-4 py-2.5 bg-primary-surface border-b border-primary/20 flex items-center justify-between">
            <span className="text-xs font-medium text-primary">Tiempo total acumulado</span>
            <span className="text-sm font-bold text-primary">{formatDuration(totalMinutes)}</span>
          </div>
        )}

        {/* Seguimiento planificado */}
        {!readOnly && (
          <div className="px-4 py-3 border-b border-border">
            <button
              onClick={() => setRemindersExpanded((v) => !v)}
              className="w-full flex items-center gap-1.5 text-xs font-semibold text-main hover:text-primary transition-colors"
            >
              <svg
                className={`w-3 h-3 shrink-0 transition-transform duration-200 ${remindersExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <span>
                Seguimiento planificado{reminders.length > 0 ? ` (${reminders.length})` : ""}
              </span>
            </button>

            <div
              className={`grid transition-all duration-300 ease-in-out ${
                remindersExpanded ? "grid-rows-[1fr] opacity-100 mt-2.5" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setShowReminderForm((v) => !v)}
                    className="text-xs font-medium text-primary hover:text-primary-hover"
                  >
                    {showReminderForm ? "Cancelar" : "+ Agregar recordatorio"}
                  </button>
                </div>

                {reminders.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {reminders.map((r) => (
                      <div key={r.id} className="flex items-start justify-between gap-2 bg-background rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-title truncate">{r.title}</p>
                          <p className="text-[10px] text-disabled">{formatReminderDateTime(r.reminderAt)}</p>
                          {r.description && (
                            <p className="text-[11px] text-secondary mt-0.5 leading-snug">{r.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteReminder(r.id)}
                          disabled={deletingReminderId === r.id}
                          className="p-0.5 text-disabled hover:text-danger transition-colors disabled:opacity-40 shrink-0"
                          title="Eliminar recordatorio"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showReminderForm && (
                  <div className="space-y-2 pt-2">
                    <input
                      type="text"
                      value={reminderTitle}
                      onChange={(e) => setReminderTitle(e.target.value)}
                      placeholder="Nombre del recordatorio"
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={reminderDate}
                        onChange={(e) => setReminderDate(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                      />
                      <TimeInput24 value={reminderTime} onChange={setReminderTime} />
                    </div>
                    <textarea
                      value={reminderDescription}
                      onChange={(e) => setReminderDescription(e.target.value)}
                      rows={2}
                      placeholder="Descripción (opcional)"
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                    />
                    {reminderError && (
                      <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{reminderError}</p>
                    )}
                    <button
                      onClick={submitReminder}
                      disabled={!reminderTitle.trim() || !reminderDate || !reminderTime || reminderSubmitting}
                      className="w-full bg-primary text-white rounded-lg py-1.5 text-xs font-medium hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {reminderSubmitting ? "Guardando…" : "Guardar recordatorio"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="text-center text-disabled text-sm py-8">Cargando…</div>
          )}
          {!loading && activities.length === 0 && (
            <div className="text-center text-disabled text-sm py-10">
              <svg className="w-10 h-10 mx-auto mb-2 text-gray-400 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Sin actividades registradas
            </div>
          )}
          {activities.map((a) => (
            <ActivityItem
              key={a.id}
              activity={a}
              taskId={task.id}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              reasons={reasons}
              onDeleted={handleActivityDeleted}
              onUpdated={handleActivityUpdated}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Add form */}
        {!readOnly && <div className="p-4 border-t border-border space-y-3">
          <p className="text-xs font-semibold text-main">Agregar actividad</p>

          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
              Motivo
            </label>
            <select
              value={effectiveReason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {selectable.length === 0 && <option value="">Sin motivos disponibles</option>}
              {selectable.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {activityFormat === "timerange" ? (
            <div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                    Hora inicio
                  </label>
                  <TimeInput24 value={startTime} onChange={setStartTime} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                    Hora fin
                  </label>
                  <TimeInput24 value={endTime} onChange={setEndTime} />
                </div>
              </div>
              {rangeError && (
                <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2 mt-2">{rangeError}</p>
              )}
              {overlapError && (
                <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2 mt-2">{overlapError}</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                  Horas
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={23}
                  value={hours}
                  onChange={(e) => setHours(clampInt(e.target.value, 0, 23))}
                  placeholder="0"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                  Minutos
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) => setMinutes(clampInt(e.target.value, 0, 59))}
                  placeholder="0"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>
          )}

          {/* Auto duration preview */}
          <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
            previewDuration
              ? "bg-primary-surface text-primary"
              : "bg-background text-disabled"
          }`}>
            <span>Duración calculada</span>
            <span className="font-semibold">
              {previewDuration ? formatDuration(previewDuration) : "—"}
            </span>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
              Descripción <span className="normal-case font-normal">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Notas o detalles de la actividad…"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={!previewDuration || !effectiveReason || !!overlapConflict || submitting}
            className="w-full bg-primary text-white rounded-xl py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Registrando…" : "Agregar actividad"}
          </button>
        </div>}
      </aside>
    </>
  );
}
