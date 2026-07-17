"use client";

import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Task } from "./types";
import type { ActivityFormat } from "@/lib/activityFormat";
import { fetchActivityReasons, selectableReasons, formatDuration, type ActivityReasonConfig } from "./activityReasons";
import { businessCalendarDay, previousBusinessDays } from "@/lib/businessTime";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import TimeInput24 from "@/components/ui/TimeInput24";

const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function formatDateOption(d: Date): string {
  const weekday = WEEKDAY_LABELS[d.getUTCDay()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${weekday} ${day}/${month}`;
}

function dateToValue(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  currentUserRole?: Role;
  activityFormat?: ActivityFormat;
  onClose: () => void;
  onSaved: () => void;
};

export default function RetroactiveActivityModal({ task, currentUserRole, activityFormat = "duration", onClose, onSaved }: Props) {
  const validDates = useMemo(() => previousBusinessDays(businessCalendarDay(new Date()), 2), []);

  const [activityDate, setActivityDate] = useState(validDates[0] ? dateToValue(validDates[0]) : "");
  const [reasons, setReasons] = useState<ActivityReasonConfig[]>([]);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchActivityReasons().then(setReasons);
  }, []);

  const selectable = useMemo(() => selectableReasons(reasons, currentUserRole), [reasons, currentUserRole]);
  // Sin sync-effect: mientras el usuario no elija explícitamente, el motivo
  // efectivo es el primero disponible una vez que la lista carga.
  const effectiveReason = reason || selectable[0]?.key || "";

  const rangeError = useMemo(() => {
    if (activityFormat !== "timerange") return "";
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    if (startMins === null || endMins === null) return "";
    if (endMins < startMins) return "La hora fin debe ser posterior a la hora inicio";
    return "";
  }, [activityFormat, startTime, endTime]);

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
    if (!description.trim()) {
      setError("La descripción es obligatoria para un registro retroactivo");
      return;
    }
    if (!activityDate) {
      setError("Selecciona una fecha");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const h = Math.floor(previewDuration / 60);
      const m = previewDuration % 60;
      const res = await fetch(`/api/tasks/${task.id}/activities/retroactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: effectiveReason,
          hours: h,
          minutes: m,
          description: description.trim(),
          activityDate,
        }),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        let msg = "Error al registrar la actividad retroactiva";
        try {
          const data = await res.json();
          msg = data.error ?? msg;
        } catch { /* respuesta sin body */ }
        setError(msg);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Registro retroactivo de horas" onClose={onClose} />
      <div className="p-5 space-y-3">
        <p className="text-xs text-secondary">
          Solo se pueden registrar horas de los últimos 2 días laborables (no incluye hoy ni fines de semana), para la tarea &ldquo;{task.title}&rdquo;.
        </p>

        {validDates.length === 0 ? (
          <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">
            No hay días laborables válidos disponibles para registro retroactivo.
          </p>
        ) : (
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
              Fecha de la actividad
            </label>
            <select
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {validDates.map((d) => (
                <option key={dateToValue(d)} value={dateToValue(d)}>
                  {formatDateOption(d)}
                </option>
              ))}
            </select>
          </div>
        )}

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

        <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
          previewDuration ? "bg-primary-surface text-primary" : "bg-background text-disabled"
        }`}>
          <span>Duración calculada</span>
          <span className="font-semibold">{previewDuration ? formatDuration(previewDuration) : "—"}</span>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
            Descripción <span className="normal-case font-normal text-danger">(obligatoria)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe por qué se registra retroactivamente esta actividad"
            className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
          />
        </div>

        {error && (
          <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={submitting || !effectiveReason || !previewDuration || !description.trim() || validDates.length === 0}
            className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {submitting ? "Registrando…" : "Registrar horas retroactivas"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
