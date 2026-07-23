"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Task, TaskActivity } from "./types";
import { ROLE_LABEL } from "@/lib/roles";
import TimeInput24 from "@/components/ui/TimeInput24";
import type { ActivityFormat } from "@/lib/activityFormat";
import { fetchActivityReasons, selectableReasons, formatDuration, type ActivityReasonConfig } from "./activityReasons";
import { rangesOverlap } from "@/lib/timeOverlap";
import { hoursToDisplay } from "@/lib/timeFormat";
import ActivityItem from "./ActivityItem";
import ValidateTargetTimeModal from "./ValidateTargetTimeModal";
import {
  TARGET_TIME_REASON_LABEL,
  type TargetTimeAdjustReason,
  type HistoricalDeviationInsight,
} from "@/lib/targetTime";

type TargetTimeAuditEntry = {
  id: string;
  previousValue: number | null;
  newValue: number;
  reason: TargetTimeAdjustReason;
  reasonDetail: string | null;
  user: { id: string; name: string };
  userRole: string;
  createdAt: string;
};

type TargetTimeInfo = {
  estimatedHours: number;
  targetTimeValidated: number | null;
  targetTimeValidatedAt: string | null;
  validatedBy: { id: string; name: string } | null;
  isValidated: boolean;
  officialTarget: number;
  realHours: number;
  deviation: { hours: number; pct: number | null };
  canValidate: boolean;
  auditHistory: TargetTimeAuditEntry[];
  historicalDeviation: HistoricalDeviationInsight;
};

type DayScheduleEntry = { id: string; startTime: string; endTime: string; taskId: string; taskTitle: string };

function formatAuditDateTime(iso: string): string {
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

  const [targetTimeInfo, setTargetTimeInfo] = useState<TargetTimeInfo | null>(null);
  const [targetTimeExpanded, setTargetTimeExpanded] = useState(true);
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);


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

  // Tareas Fijas: máximo 2 registros (ver FIJA_MAX_ACTIVITIES en
  // /api/tasks/[id]/activities/route.ts, misma regla aplicada en el servidor).
  const fijaLimitReached = task.type === "FIJA" && activities.length >= 2;

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

  const loadTargetTime = useMemo(
    () => () =>
      fetch(`/api/tasks/${task.id}/target-time`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setTargetTimeInfo(data))
        .catch(() => setTargetTimeInfo(null)),
    [task.id]
  );

  useEffect(() => {
    loadTargetTime();
  }, [loadTargetTime]);

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
            <p className="text-xs text-secondary">{readOnly ? "Actividades registradas" : "Registro de actividades"}</p>
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

        {/* Tiempo Objetivo (§Sprint 6) */}
        {targetTimeInfo && (
          <div className="px-4 py-3 border-b border-border">
            <button
              onClick={() => setTargetTimeExpanded((v) => !v)}
              className="w-full flex items-center gap-1.5 text-xs font-semibold text-main hover:text-primary transition-colors"
            >
              <svg
                className={`w-3 h-3 shrink-0 transition-transform duration-200 ${targetTimeExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <span>Tiempo Objetivo</span>
            </button>

            <div
              className={`grid transition-all duration-300 ease-in-out ${
                targetTimeExpanded ? "grid-rows-[1fr] opacity-100 mt-2.5" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary">Tiempo objetivo</span>
                  <span className="font-semibold text-title flex items-center gap-1.5">
                    {hoursToDisplay(targetTimeInfo.officialTarget)}h
                    {targetTimeInfo.isValidated ? (
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-success/[.13] text-success"
                        title={targetTimeInfo.validatedBy ? `Validado por ${targetTimeInfo.validatedBy.name}` : "Validado"}
                      >
                        Validado
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-warning/[.15] text-warning">
                        Pendiente de validar
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary">Horas reales</span>
                  <span className="font-semibold text-title">{hoursToDisplay(targetTimeInfo.realHours)}h</span>
                </div>
                {targetTimeInfo.realHours > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary">Desviación</span>
                    <span className={`font-semibold ${targetTimeInfo.deviation.hours > 0 ? "text-danger" : targetTimeInfo.deviation.hours < 0 ? "text-success" : "text-disabled"}`}>
                      {targetTimeInfo.deviation.hours > 0 ? "+" : ""}
                      {targetTimeInfo.deviation.hours}h
                      {targetTimeInfo.deviation.pct !== null && ` (${targetTimeInfo.deviation.pct > 0 ? "+" : ""}${targetTimeInfo.deviation.pct}%)`}
                    </span>
                  </div>
                )}

                {targetTimeInfo.historicalDeviation.available && (
                  <p className="text-[11px] text-warning bg-warning/[.08] rounded-lg px-2.5 py-2 leading-relaxed">
                    {targetTimeInfo.historicalDeviation.recommendation}
                  </p>
                )}

                {targetTimeInfo.canValidate && (
                  <button
                    onClick={() => setValidateOpen(true)}
                    className="w-full bg-primary text-white rounded-lg py-1.5 text-xs font-medium hover:bg-primary-hover transition-colors"
                  >
                    Validar tiempo objetivo
                  </button>
                )}

                {targetTimeInfo.auditHistory.length > 0 && (
                  <div>
                    <button
                      onClick={() => setAuditExpanded((v) => !v)}
                      className="text-[11px] font-medium text-primary hover:text-primary-hover"
                    >
                      {auditExpanded ? "Ocultar" : "Ver"} historial de validaciones ({targetTimeInfo.auditHistory.length})
                    </button>
                    {auditExpanded && (
                      <div className="space-y-1.5 mt-2">
                        {targetTimeInfo.auditHistory.map((a) => (
                          <div key={a.id} className="bg-background rounded-lg px-2.5 py-2 text-[11px] space-y-0.5">
                            <p className="text-title font-medium">
                              {a.previousValue !== null ? `${hoursToDisplay(a.previousValue)}h → ` : ""}
                              {hoursToDisplay(a.newValue)}h
                            </p>
                            <p className="text-secondary">{TARGET_TIME_REASON_LABEL[a.reason]}{a.reasonDetail ? `: ${a.reasonDetail}` : ""}</p>
                            <p className="text-disabled">
                              {a.user.name} ({ROLE_LABEL[a.userRole as Role] ?? a.userRole}) · {formatAuditDateTime(a.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {validateOpen && targetTimeInfo && (
          <ValidateTargetTimeModal
            taskId={task.id}
            taskTitle={task.title}
            currentValue={targetTimeInfo.officialTarget}
            historicalDeviation={targetTimeInfo.historicalDeviation}
            onClose={() => setValidateOpen(false)}
            onValidated={() => {
              setValidateOpen(false);
              loadTargetTime();
            }}
          />
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
        {!readOnly && fijaLimitReached && (
          <div className="p-4 border-t border-border">
            <p className="text-xs text-warning bg-warning/[.08] rounded-lg px-3 py-2.5 text-center leading-relaxed">
              Esta tarea fija ya alcanzó el número máximo de registros permitidos.
            </p>
          </div>
        )}
        {!readOnly && !fijaLimitReached && <div className="p-4 border-t border-border space-y-3">
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
