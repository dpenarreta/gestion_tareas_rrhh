"use client";

import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import type { ProjectActivity, ProjectPhase } from "./types";
import { businessCalendarDay, previousBusinessDays } from "@/lib/businessTime";

const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function dateToValue(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateOption(d: Date, isToday: boolean): string {
  const weekday = WEEKDAY_LABELS[d.getUTCDay()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${isToday ? "Hoy — " : ""}${weekday} ${day}/${month}`;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function clampInt(value: string, min: number, max: number): string {
  if (value === "") return "";
  const n = Math.trunc(Number(value));
  if (Number.isNaN(n)) return "";
  return String(Math.min(max, Math.max(min, n)));
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

type Props = {
  projectId: string;
  phases: ProjectPhase[];
  currentUserId: string;
  currentUserRole?: Role;
  canRegister: boolean;
};

export default function ProjectActivitiesTab({ projectId, phases, canRegister }: Props) {
  const today = useMemo(() => businessCalendarDay(new Date()), []);
  const validDates = useMemo(() => [today, ...previousBusinessDays(today, 2)], [today]);

  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityDate, setActivityDate] = useState(dateToValue(today));
  const [phaseId, setPhaseId] = useState("");
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [time, setTime] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${projectId}/activities`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setActivities(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [projectId]);

  const totalMinutes = activities.reduce((sum, a) => sum + a.duration, 0);

  async function submit() {
    if (!description.trim() || hours === "" || minutes === "" || submitting) return;
    const h = Number(hours) || 0;
    const m = Number(minutes) || 0;
    if (h * 60 + m <= 0) {
      setError("La duración debe ser mayor a 0");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          comments: comments.trim() || undefined,
          time: time || undefined,
          hours: h,
          minutes: m,
          phaseId: phaseId || undefined,
          activityDate,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setActivities((prev) => [...prev, created]);
        setDescription("");
        setComments("");
        setTime("");
        setHours("");
        setMinutes("");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al registrar la actividad");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-2">
        {loading && <div className="text-center text-disabled text-sm py-8">Cargando…</div>}
        {!loading && activities.length === 0 && (
          <div className="text-center text-disabled text-sm py-12 bg-surface border border-border rounded-2xl">Sin actividades registradas</div>
        )}
        {activities.map((a) => {
          const phase = phases.find((p) => p.id === a.phaseId);
          return (
            <div key={a.id} className="bg-surface border border-border rounded-2xl p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-title font-medium">{a.description}</p>
                  <p className="text-xs text-secondary mt-0.5">
                    {a.author.name} · {formatWhen(a.createdAt)}
                    {phase && ` · ${phase.name}`}
                    {a.isRetroactive && " · retroactivo"}
                  </p>
                  {a.comments && <p className="text-xs text-secondary mt-1">{a.comments}</p>}
                </div>
                <span className="text-xs font-semibold text-primary shrink-0">{formatDuration(a.duration)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="bg-primary-surface rounded-2xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-primary">Tiempo total acumulado</span>
          <span className="text-sm font-bold text-primary">{formatDuration(totalMinutes)}</span>
        </div>

        {canRegister && (
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-main">Registrar actividad</p>

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fecha</label>
              <select
                value={activityDate}
                onChange={(e) => setActivityDate(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              >
                {validDates.map((d, i) => (
                  <option key={dateToValue(d)} value={dateToValue(d)}>{formatDateOption(d, i === 0)}</option>
                ))}
              </select>
            </div>

            {phases.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fase (opcional)</label>
                <select
                  value={phaseId}
                  onChange={(e) => setPhaseId(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="">Sin fase específica</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Descripción</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="¿Qué hiciste?"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Hora</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full border border-border rounded-xl px-2 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Horas</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hours}
                  onChange={(e) => setHours(clampInt(e.target.value, 0, 23))}
                  className="w-full border border-border rounded-xl px-2 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Min</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) => setMinutes(clampInt(e.target.value, 0, 59))}
                  className="w-full border border-border rounded-xl px-2 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                Comentarios <span className="normal-case font-normal">(opcional)</span>
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={2}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
            </div>

            {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

            <button
              onClick={submit}
              disabled={!description.trim() || hours === "" || minutes === "" || submitting}
              className="w-full bg-primary text-white rounded-xl py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Registrando…" : "Agregar actividad"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
