"use client";

import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import type { ProjectActivity, ProjectPhase } from "./types";
import { DOCUMENT_CATEGORY_LABEL } from "./types";
import { businessCalendarDay, retroactiveValidDates } from "@/lib/businessTime";
import { useToast } from "@/components/ui/Toast";
import { formatDuration } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";

const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Sprint 2.1 §7: descripción obligatoria, mínimo 15 caracteres (igual regla que el servidor).
const MIN_DESCRIPTION_LENGTH = 15;

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

function formatDayHeader(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function dayKey(a: ProjectActivity): string {
  // El día de agrupación es activityDate (registro retroactivo) o el día calendario de createdAt.
  return (a.activityDate ?? a.createdAt).slice(0, 10);
}

async function downloadDocument(projectId: string, documentId: string, fileName: string, mimeType: string | null, onError: () => void) {
  const res = await fetch(`/api/projects/${projectId}/documents/${documentId}`);
  if (!res.ok) {
    onError();
    return;
  }
  const data = await res.json();
  const link = document.createElement("a");
  link.href = `data:${mimeType || "application/octet-stream"};base64,${data.fileData}`;
  link.download = fileName;
  link.click();
}

type Props = {
  projectId: string;
  phases: ProjectPhase[];
  targetTimeHours: number;
  currentUserId: string;
  currentUserRole?: Role;
  canRegister: boolean;
};

export default function ProjectActivitiesTab({ projectId, phases, targetTimeHours, currentUserId, canRegister }: Props) {
  const { showToast } = useToast();
  const today = useMemo(() => businessCalendarDay(new Date()), []);
  const validDates = useMemo(() => [today, ...retroactiveValidDates(today, 2)], [today]);

  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityDate, setActivityDate] = useState(dateToValue(today));
  const [phaseId, setPhaseId] = useState("");
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/activities`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setActivities(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [projectId]);

  const totalMinutes = activities.reduce((sum, a) => sum + a.duration, 0);
  const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
  const remainingHours = Math.max(0, Math.round((targetTimeHours - totalHours) * 100) / 100);
  const executedPct = targetTimeHours > 0 ? Math.min(100, Math.round((totalHours / targetTimeHours) * 100)) : 0;

  // Sprint 2.1 §5: solo se muestran fases donde el usuario es responsable,
  // ya participó (tiene alguna actividad registrada ahí), o la fase está sin
  // responsable asignado (abierta a cualquiera) — el resto se oculta.
  const visiblePhases = useMemo(
    () =>
      phases.filter(
        (p) =>
          p.responsible?.id === currentUserId ||
          !p.responsible ||
          activities.some((a) => a.phaseId === p.id && a.author.id === currentUserId)
      ),
    [phases, activities, currentUserId]
  );

  const previewDuration = useMemo(() => {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
    const total = eh * 60 + em - (sh * 60 + sm);
    return total > 0 ? total : null;
  }, [startTime, endTime]);

  const descriptionTooShort = description.trim().length > 0 && description.trim().length < MIN_DESCRIPTION_LENGTH;

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, ProjectActivity[]>();
    for (const a of activities) {
      const key = dayKey(a);
      const list = groups.get(key) ?? [];
      list.push(a);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [activities]);

  async function submit() {
    const trimmedDescription = description.trim();
    if (trimmedDescription.length < MIN_DESCRIPTION_LENGTH || !previewDuration || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: trimmedDescription,
          comments: comments.trim() || undefined,
          startTime,
          endTime,
          phaseId: phaseId || undefined,
          activityDate,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setActivities((prev) => [...prev, created]);
        setDescription("");
        setComments("");
        setStartTime("");
        setEndTime("");
        showToast("Actividad registrada.", "success");
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error ?? "No se pudo registrar la actividad.", "error", { label: "Reintentar", onClick: submit });
      }
    } catch {
      showToast("Error de conexión.", "error", { label: "Reintentar", onClick: submit });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Sprint 2.1 §8: timeline cronológico por día. */}
      <div className="lg:col-span-2 space-y-4">
        {loading && <div className="text-center text-disabled text-sm py-8">Cargando…</div>}
        {!loading && activities.length === 0 && <EmptyState icon={Clock} title="Sin actividades registradas" />}
        {groupedByDay.map(([day, dayActivities]) => (
          <div key={day}>
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{formatDayHeader(day)}</p>
            <div className="space-y-2">
              {dayActivities.map((a) => {
                const phase = phases.find((p) => p.id === a.phaseId);
                return (
                  <div key={a.id} className="bg-surface border border-border rounded-2xl p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-title font-medium">{a.description}</p>
                        <p className="text-xs text-secondary mt-0.5">
                          {a.author.name}
                          {a.startTime && a.endTime && ` · ${a.startTime}–${a.endTime}`}
                          {phase && ` · ${phase.name}`}
                          {a.isRetroactive && " · retroactivo"}
                        </p>
                        {a.comments && <p className="text-xs text-secondary mt-1">{a.comments}</p>}
                        {a.documents.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {a.documents.map((doc) => (
                              <button
                                key={doc.id}
                                onClick={() =>
                                  downloadDocument(projectId, doc.id, doc.fileName, doc.mimeType, () =>
                                    showToast("No se pudo descargar el documento.", "error")
                                  )
                                }
                                className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-surface text-primary hover:bg-primary/[.18]"
                                title={`Descargar (${DOCUMENT_CATEGORY_LABEL[doc.category]})`}
                              >
                                📎 {doc.fileName}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-primary shrink-0">{formatDuration(a.duration)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {/* Sprint 2.1 §9: tarjeta de tiempo acumulado con desglose completo. */}
        <div className="bg-surface border border-border rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-title mb-3">Tiempo acumulado</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-secondary">Horas registradas</span>
              <span className="font-semibold text-title">{totalHours}h</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-secondary">Tiempo objetivo</span>
              <span className="font-semibold text-title">{targetTimeHours}h</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-secondary">Horas restantes</span>
              <span className="font-semibold text-title">{remainingHours}h</span>
            </div>
          </div>
          <div className="h-2 rounded-full bg-surface2 overflow-hidden mt-3">
            <div className="h-full rounded-full bg-primary" style={{ width: `${executedPct}%` }} />
          </div>
          <p className="text-xs text-disabled mt-1.5">{executedPct}% ejecutado</p>
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

            {visiblePhases.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Fase (opcional)</label>
                <select
                  value={phaseId}
                  onChange={(e) => setPhaseId(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="">Sin fase específica</option>
                  {visiblePhases.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
                Descripción <span className="normal-case font-normal">(mínimo {MIN_DESCRIPTION_LENGTH} caracteres)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="¿Qué hiciste?"
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
              {descriptionTooShort && (
                <p className="text-[11px] text-warning mt-1">
                  Faltan {MIN_DESCRIPTION_LENGTH - description.trim().length} caracteres
                </p>
              )}
            </div>

            {/* Sprint 2.1 §6: solo hora inicio/hora fin — sin campo de duración manual. */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Hora inicio</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-border rounded-xl px-2 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Hora fin</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-border rounded-xl px-2 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${previewDuration ? "bg-primary-surface text-primary" : "bg-background text-disabled"}`}>
              <span>Duración calculada</span>
              <span className="font-semibold">{previewDuration ? formatDuration(previewDuration) : "—"}</span>
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

            <Button
              onClick={submit}
              disabled={description.trim().length < MIN_DESCRIPTION_LENGTH || !previewDuration}
              loading={submitting}
              className="w-full"
            >
              {submitting ? "Registrando…" : "Agregar actividad"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
