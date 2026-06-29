"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { Task, TaskActivity, ActivityReason } from "./types";

const REASON_OPTIONS: { value: ActivityReason; label: string }[] = [
  { value: "NOVEDADES_PAGO", label: "Novedades de Pago" },
  { value: "RETENCION_PAGO", label: "Retención de Pago" },
  { value: "FACTURAS", label: "Facturas" },
  { value: "CONSULTA_OPERACIONES", label: "Consulta de Operaciones" },
  { value: "SOLICITUD_VACACIONES", label: "Solicitud de Vacaciones" },
  { value: "SOLICITUD_PERMISO", label: "Solicitud de Permiso" },
  { value: "VISITA_DOMICILIARIA", label: "Visita Domiciliaria" },
  { value: "SEGUIMIENTO_AUSENTISMOS", label: "Seguimiento de Ausentismos" },
  { value: "RECLUTAMIENTO_SELECCION", label: "Reclutamiento y Selección" },
];

function calcDuration(start: string, end: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? mins : null;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const REASON_COLORS: Record<ActivityReason, string> = {
  NOVEDADES_PAGO: "bg-blue-50 text-blue-700 border-blue-200",
  RETENCION_PAGO: "bg-orange-50 text-orange-700 border-orange-200",
  FACTURAS: "bg-amber-50 text-amber-700 border-amber-200",
  CONSULTA_OPERACIONES: "bg-violet-50 text-violet-700 border-violet-200",
  SOLICITUD_VACACIONES: "bg-green-50 text-green-700 border-green-200",
  SOLICITUD_PERMISO: "bg-rose-50 text-rose-700 border-rose-200",
  VISITA_DOMICILIARIA: "bg-teal-50 text-teal-700 border-teal-200",
  SEGUIMIENTO_AUSENTISMOS: "bg-cyan-50 text-cyan-700 border-cyan-200",
  RECLUTAMIENTO_SELECCION: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

type Props = {
  task: Task;
  currentUserId: string;
  onClose: () => void;
};

export default function ActivityPanel({ task, currentUserId, onClose }: Props) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [reason, setReason] = useState<ActivityReason>("NOVEDADES_PAGO");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  const previewDuration = useMemo(
    () => calcDuration(startTime, endTime),
    [startTime, endTime]
  );

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  async function submit() {
    if (!startTime || !endTime || submitting) return;
    if (!previewDuration) {
      setError("La hora de fin debe ser posterior a la hora de inicio");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, startTime, endTime, description: description.trim() || null }),
      });
      if (res.ok) {
        const activity = await res.json();
        setActivities((prev) => [...prev, activity]);
        setStartTime("");
        setEndTime("");
        setDescription("");
        setReason("NOVEDADES_PAGO");
      } else {
        const data = await res.json();
        setError(data.error ?? "Error al registrar");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(activityId: string) {
    setDeletingId(activityId);
    try {
      const res = await fetch(`/api/tasks/${task.id}/activities/${activityId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setActivities((prev) => prev.filter((a) => a.id !== activityId));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 text-sm truncate">{task.title}</h3>
            <p className="text-xs text-slate-500">Registro de actividades</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Total summary */}
        {totalMinutes > 0 && (
          <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-700">Tiempo total acumulado</span>
            <span className="text-sm font-bold text-indigo-800">{formatDuration(totalMinutes)}</span>
          </div>
        )}

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="text-center text-slate-400 text-sm py-8">Cargando…</div>
          )}
          {!loading && activities.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-10">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Sin actividades registradas
            </div>
          )}
          {activities.map((a) => {
            const label = REASON_OPTIONS.find((o) => o.value === a.reason)?.label ?? a.reason;
            const colorClass = REASON_COLORS[a.reason];
            const canDelete = a.author.id === currentUserId;
            return (
              <div key={a.id} className="bg-slate-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
                    {label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">{formatDate(a.createdAt)}</span>
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        className="p-0.5 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                        title="Eliminar actividad"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {a.startTime} → {a.endTime}
                  </div>
                  <span className="text-xs font-semibold text-indigo-700">
                    {formatDuration(a.duration)}
                  </span>
                </div>
                {a.description && (
                  <p className="text-xs text-slate-600 leading-relaxed">{a.description}</p>
                )}
                <p className="text-[10px] text-slate-400">{a.author.name}</p>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Add form */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <p className="text-xs font-semibold text-slate-700">Agregar actividad</p>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
              Motivo
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ActivityReason)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
            >
              {REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
                Hora inicio
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
                Hora fin
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              />
            </div>
          </div>

          {/* Auto duration preview */}
          <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
            previewDuration
              ? "bg-indigo-50 text-indigo-700"
              : "bg-slate-50 text-slate-400"
          }`}>
            <span>Duración calculada</span>
            <span className="font-semibold">
              {previewDuration ? formatDuration(previewDuration) : "—"}
            </span>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
              Descripción <span className="normal-case font-normal">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Notas o detalles de la actividad…"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={!startTime || !endTime || !previewDuration || submitting}
            className="w-full bg-indigo-600 text-white rounded-xl py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Registrando…" : "Agregar actividad"}
          </button>
        </div>
      </aside>
    </>
  );
}
