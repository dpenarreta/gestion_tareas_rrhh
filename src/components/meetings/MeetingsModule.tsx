"use client";

import { useState, useEffect, useCallback } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import TimeInput24 from "@/components/ui/TimeInput24";
import { useToast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type MeetingStatus = "PROGRAMADA" | "EN_CURSO" | "FINALIZADA";

type Invitee = {
  id: string;
  userId: string;
  attended: boolean;
  user: { id: string; name: string; role: Role };
};

type Meeting = {
  id: string;
  title: string;
  description: string | null;
  hostId: string;
  host: { id: string; name: string; role: Role };
  meetingDate: string;
  duration: number;
  zoomMeetingId: string | null;
  zoomJoinUrl: string | null;
  zoomPassword: string | null;
  status: MeetingStatus;
  otterInvited: boolean;
  otterSummary: string | null;
  otterTranscriptUrl: string | null;
  createdAt: string;
  invitees: Invitee[];
};

type AssignableUser = { id: string; name: string; email: string; role: Role };

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-indigo-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-violet-500 to-purple-500",
];

function avatarGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

const STATUS_CFG: Record<MeetingStatus, { label: string; cls: string }> = {
  PROGRAMADA: { label: "Programada", cls: "bg-primary-surface text-primary border-transparent" },
  EN_CURSO: { label: "En curso", cls: "bg-success/[.13] text-success border-transparent" },
  FINALIZADA: { label: "Finalizada", cls: "bg-surface2 text-secondary border-border" },
};

function StatusBadge({ status }: { status: MeetingStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const s = size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs";
  return (
    <div className={`${s} rounded-full bg-gradient-to-br ${avatarGradient(name)} flex items-center justify-center font-bold text-white shrink-0`}>
      {initials(name)}
    </div>
  );
}

// ── Meeting Form Modal ────────────────────────────────────────────────────────

function MeetingFormModal({
  onClose,
  onSaved,
  currentUserId,
}: {
  onClose: () => void;
  onSaved: (m: Meeting) => void;
  currentUserId: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(40);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    queueMicrotask(() => {
      fetch("/api/users/assignable")
        .then((r) => r.json())
        .then((all: AssignableUser[]) => setUsers(all.filter((u) => u.id !== currentUserId)));
      setDate(new Date().toISOString().slice(0, 10));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleUser(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim() || !date || !time) { setError("Completa todos los campos obligatorios"); return; }
    setSaving(true);
    try {
      const meetingDate = new Date(`${date}T${time}:00`).toISOString();
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, meetingDate, duration, inviteeIds: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? "Error al crear reunión.", "error"); }
      else { showToast("Reunión creada.", "success"); onSaved(data); }
    } catch { showToast("Error de conexión.", "error"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-title">Nueva reunión</h2>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Reunión de seguimiento mensual"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Descripción</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda u objetivo de la reunión (opcional)"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Fecha *</label>
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Hora *</label>
              <TimeInput24 required value={time} onChange={setTime}
                selectClassName="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Duración</label>
            <div className="flex gap-2">
              {([
                { value: 30, label: "30 min" },
                { value: 40, label: "40 min (máx. recomendado)" },
              ] as { value: number; label: string }[]).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => setDuration(value)}
                  className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-colors ${duration === value ? "bg-primary text-white border-primary" : "text-main border-border hover:border-primary/40"}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-warning">⚠️ Plan Zoom gratuito: máximo 40 minutos con más de 2 participantes</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">
              Invitados ({selectedIds.length} seleccionados)
            </label>
            <div className="border border-border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
              {users.length === 0 ? (
                <p className="text-sm text-disabled text-center py-4">Cargando usuarios…</p>
              ) : (
                users.map((u) => (
                  <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border-b border-border last:border-0">
                    <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => toggleUser(u.id)} className="rounded" />
                    <Avatar name={u.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-title truncate">{u.name}</p>
                      <p className="text-[10px] text-disabled">{ROLE_LABEL[u.role]}</p>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" loading={saving} className="flex-1">
              {saving ? "Creando…" : "Crear reunión"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Meeting Detail Modal ───────────────────────────────────────────────────────

function MeetingDetailModal({
  meeting: initial,
  currentUserId,
  onClose,
  onUpdated,
  onDeleted,
}: {
  meeting: Meeting;
  currentUserId: string;
  onClose: () => void;
  onUpdated: (m: Meeting) => void;
  onDeleted: (id: string) => void;
}) {
  const [meeting, setMeeting] = useState(initial);
  const [editSummary, setEditSummary] = useState(false);
  const [summaryText, setSummaryText] = useState(initial.otterSummary ?? "");
  const [transcriptUrl, setTranscriptUrl] = useState(initial.otterTranscriptUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const isHost = meeting.hostId === currentUserId;

  async function patch(data: Record<string, unknown>, successMessage?: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated: Meeting = await res.json();
        setMeeting(updated);
        onUpdated(updated);
        if (successMessage) showToast(successMessage, "success");
        return true;
      }
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error ?? "Error al actualizar la reunión.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSummary() {
    const ok = await patch(
      { otterSummary: summaryText.trim() || null, otterTranscriptUrl: transcriptUrl.trim() || null },
      "Notas guardadas."
    );
    if (ok) setEditSummary(false);
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar la reunión "${meeting.title}"?`)) return;
    const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error ?? "Error al eliminar la reunión.", "error");
      return;
    }
    showToast("Reunión eliminada.", "success");
    onDeleted(meeting.id);
    onClose();
  }

  function copyOtterEmail() {
    navigator.clipboard.writeText("meet@otter.ai");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const STATUS_OPTIONS: MeetingStatus[] = ["PROGRAMADA", "EN_CURSO", "FINALIZADA"];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface px-6 py-4 border-b border-border flex items-start justify-between gap-4 rounded-t-2xl">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={meeting.status} />
              {meeting.otterSummary && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-transparent bg-success/[.13] text-success font-medium">
                  📝 Notas disponibles
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-title leading-tight">{meeting.title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isHost && (
              <button onClick={handleDelete} aria-label="Eliminar reunión" className="p-1.5 text-disabled hover:text-danger hover:bg-danger/[.09] rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
              <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Info */}
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="Fecha" value={formatDate(meeting.meetingDate)} />
            <InfoRow label="Hora" value={fmtTime(meeting.meetingDate)} />
            <InfoRow label="Duración" value={fmtDuration(meeting.duration)} />
            <InfoRow label="Anfitrión" value={meeting.host.name} />
          </div>

          {meeting.description && (
            <div>
              <p className="text-xs font-semibold text-disabled uppercase tracking-wider mb-1">Descripción</p>
              <p className="text-sm text-main">{meeting.description}</p>
            </div>
          )}

          {/* Participants */}
          {meeting.invitees.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-disabled uppercase tracking-wider mb-3">
                Participantes ({meeting.invitees.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {meeting.invitees.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-xl border border-border">
                    <Avatar name={inv.user.name} size="sm" />
                    <span className="text-sm text-main">{inv.user.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status control (host only) */}
          {isHost && (
            <div>
              <p className="text-xs font-semibold text-disabled uppercase tracking-wider mb-2">Estado</p>
              <div className="flex gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <button key={s} onClick={() => patch({ status: s }, `Estado actualizado a "${STATUS_CFG[s].label}".`)} disabled={saving}
                    className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors disabled:opacity-50 ${meeting.status === s ? "bg-primary text-white border-primary" : "text-main border-border hover:border-primary/40"}`}>
                    {STATUS_CFG[s].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Zoom */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15 10l4.553-2.369A1 1 0 0121 8.5V15.5a1 1 0 01-1.447.894L15 14m0 0V10m0 4H3a1 1 0 01-1-1V7a1 1 0 011-1h12v8z"/>
              </svg>
              <span className="text-sm font-semibold text-blue-800">Unirse a Zoom</span>
            </div>
            {meeting.zoomJoinUrl ? (
              <div className="space-y-2">
                <a href={meeting.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Abrir Zoom
                </a>
                <div className="flex gap-2 text-xs text-blue-700">
                  <span>ID: {meeting.zoomMeetingId}</span>
                  {meeting.zoomPassword && <span>· Contraseña: {meeting.zoomPassword}</span>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-blue-600">Link de Zoom no disponible.</p>
            )}
          </div>

          {/* Otter.ai */}
          <div className="bg-cyan-500/10 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🦦</span>
              <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Note taker — Otter.ai</span>
            </div>
            <p className="text-xs text-cyan-700 dark:text-cyan-300 mb-3">
              Para activar la transcripción automática, invita a{" "}
              <span className="font-mono font-semibold">meet@otter.ai</span> como participante en Zoom.
            </p>
            <div className="flex items-center gap-3">
              <button onClick={copyOtterEmail}
                className="flex items-center gap-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-300 bg-surface border border-border2 px-3 py-1.5 rounded-lg hover:bg-cyan-500/10 transition-colors">
                {copied ? "✓ Copiado" : "Copiar email de Otter"}
              </button>
              {isHost && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={meeting.otterInvited}
                    onChange={(e) => patch({ otterInvited: e.target.checked })}
                    disabled={saving} className="rounded" />
                  <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">Otter invitado ✓</span>
                </label>
              )}
              {!isHost && meeting.otterInvited && (
                <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">✓ Otter fue invitado</span>
              )}
            </div>
          </div>

          {/* Summary */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-disabled uppercase tracking-wider">Resumen y notas</p>
              {isHost && !editSummary && (
                <button onClick={() => { setEditSummary(true); setSummaryText(meeting.otterSummary ?? ""); setTranscriptUrl(meeting.otterTranscriptUrl ?? ""); }}
                  className="text-xs font-medium text-primary hover:text-primary-hover px-2 py-1 rounded-lg hover:bg-primary-surface transition-colors">
                  {meeting.otterSummary ? "Editar" : "Agregar resumen"}
                </button>
              )}
            </div>

            {editSummary ? (
              <div className="space-y-3">
                <textarea rows={6} value={summaryText} onChange={(e) => setSummaryText(e.target.value)}
                  placeholder="Pega aquí el resumen de Otter.ai o escribe tus notas de la reunión…"
                  className="w-full px-3 py-2.5 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-y" />
                <input type="url" value={transcriptUrl} onChange={(e) => setTranscriptUrl(e.target.value)}
                  placeholder="Link a transcripción completa (opcional)"
                  className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
                <div className="flex gap-2">
                  <Button onClick={handleSaveSummary} loading={saving}>
                    {saving ? "Guardando…" : "Guardar notas"}
                  </Button>
                  <Button variant="secondary" onClick={() => setEditSummary(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : meeting.otterSummary ? (
              <div className="space-y-3">
                <div className="bg-background border border-border rounded-xl px-4 py-3">
                  <p className="text-sm text-main whitespace-pre-wrap leading-relaxed">{meeting.otterSummary}</p>
                </div>
                {meeting.otterTranscriptUrl && (
                  <a href={meeting.otterTranscriptUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Ver transcripción completa en Otter.ai
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-disabled italic">
                Sin notas aún — {isHost ? "puedes agregar el resumen de Otter al finalizar la reunión." : "el anfitrión puede agregar el resumen de Otter al finalizar."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-disabled uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-medium text-title">{value}</p>
    </div>
  );
}

// ── Meeting Card ──────────────────────────────────────────────────────────────

function MeetingCard({ meeting, currentUserId, onClick }: { meeting: Meeting; currentUserId: string; onClick: () => void }) {
  const isHost = meeting.hostId === currentUserId;
  return (
    <button onClick={onClick} className="w-full text-left bg-surface border border-border rounded-2xl p-4 hover:border-primary/30 hover:shadow-sm transition-all group">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={meeting.status} />
          {meeting.otterSummary && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-transparent bg-success/[.13] text-success font-medium">
              📝 Notas disponibles
            </span>
          )}
          {isHost && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-background text-secondary font-medium">
              Anfitrión
            </span>
          )}
        </div>
        <svg className="w-4 h-4 text-disabled group-hover:text-primary transition-colors shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      <h3 className="text-base font-semibold text-title mb-2 leading-snug">{meeting.title}</h3>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary mb-3">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {formatDate(meeting.meetingDate)}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {fmtTime(meeting.meetingDate)} · {fmtDuration(meeting.duration)}
        </span>
        <span>👤 {meeting.host.name}</span>
      </div>

      {meeting.invitees.length > 0 && (
        <div className="flex items-center gap-1">
          <div className="flex -space-x-1.5">
            {meeting.invitees.slice(0, 5).map((inv) => (
              <div key={inv.id} title={inv.user.name} className={`w-6 h-6 rounded-full bg-gradient-to-br ${avatarGradient(inv.user.name)} flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-white`}>
                {initials(inv.user.name)}
              </div>
            ))}
          </div>
          {meeting.invitees.length > 5 && (
            <span className="text-xs text-disabled ml-1">+{meeting.invitees.length - 5}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ── Main Module ───────────────────────────────────────────────────────────────

export default function MeetingsModule({
  currentUserId,
  canCreate,
}: {
  currentUserId: string;
  canCreate: boolean;
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/meetings");
    if (res.ok) setMeetings(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  function handleSaved(m: Meeting) {
    setMeetings((prev) => [m, ...prev].sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime()));
    setShowForm(false);
  }

  function handleUpdated(m: Meeting) {
    setMeetings((prev) => prev.map((x) => x.id === m.id ? m : x));
    setSelected(m);
  }

  function handleDeleted(id: string) {
    setMeetings((prev) => prev.filter((x) => x.id !== id));
  }

  const now = new Date();
  const upcoming = meetings.filter((m) => new Date(m.meetingDate) >= now || m.status === "EN_CURSO");
  const past = meetings.filter((m) => new Date(m.meetingDate) < now && m.status !== "EN_CURSO");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-secondary">Zoom + notas automáticas con Otter.ai</p>
        {canCreate && (
          <Button onClick={() => setShowForm(true)}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva reunión
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner className="w-6 h-6 text-primary" />
        </div>
      ) : meetings.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">📅</p>
          <p className="text-secondary font-medium">No tienes reuniones programadas</p>
          {canCreate && (
            <button onClick={() => setShowForm(true)} className="mt-4 text-sm text-primary hover:text-primary-hover font-medium">
              Crear tu primera reunión →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-disabled uppercase tracking-wider mb-4">
                Próximas ({upcoming.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {upcoming.map((m) => (
                  <MeetingCard key={m.id} meeting={m} currentUserId={currentUserId} onClick={() => setSelected(m)} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-disabled uppercase tracking-wider mb-4">
                Anteriores ({past.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[...past].reverse().map((m) => (
                  <MeetingCard key={m.id} meeting={m} currentUserId={currentUserId} onClick={() => setSelected(m)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showForm && <MeetingFormModal onClose={() => setShowForm(false)} onSaved={handleSaved} currentUserId={currentUserId} />}
      {selected && (
        <MeetingDetailModal
          meeting={selected}
          currentUserId={currentUserId}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
