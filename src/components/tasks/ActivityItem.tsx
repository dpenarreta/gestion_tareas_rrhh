"use client";

import { useState } from "react";
import type { Role } from "@/generated/prisma/client";
import type { TaskActivity, ActivityComment } from "./types";
import { reasonLabel, reasonIsActive, reasonIsArchived, reasonColorClass, formatDuration, type ActivityReasonConfig } from "./activityReasons";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";

function formatActivityDateTime(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${mins}`;
}

function formatCommentDateTime(iso: string): string {
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

type Props = {
  activity: TaskActivity;
  taskId: string;
  currentUserId: string;
  currentUserRole?: Role;
  reasons: ActivityReasonConfig[];
  onDeleted: (activityId: string) => void;
  onUpdated: (activity: TaskActivity) => void;
};

export default function ActivityItem({ activity: a, taskId, currentUserId, currentUserRole, reasons, onDeleted, onUpdated }: Props) {
  const [deleting, setDeleting] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<ActivityComment[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");

  const [editing, setEditing] = useState(false);
  const [editHours, setEditHours] = useState("");
  const [editMinutes, setEditMinutes] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");

  const label = reasonLabel(reasons, a.reason);
  const colorClass = reasonColorClass(a.reason);
  const reasonArchived = reasonIsArchived(reasons, a.reason);
  const reasonInactive = !reasonArchived && !reasonIsActive(reasons, a.reason);
  const canDelete = a.author.id === currentUserId;
  const isAdmin = currentUserRole === "ADMINISTRADOR";

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities/${a.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(a.id);
    } finally {
      setDeleting(false);
    }
  }

  async function toggleComments() {
    const next = !showComments;
    setShowComments(next);
    if (next && comments === null) {
      setCommentsLoading(true);
      try {
        const res = await fetch(`/api/tasks/${taskId}/activities/${a.id}/comments`);
        const data = res.ok ? await res.json() : [];
        setComments(Array.isArray(data) ? data : []);
      } catch {
        setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    }
  }

  async function submitComment() {
    if (!commentText.trim() || commentSubmitting) return;
    setCommentSubmitting(true);
    setCommentError("");
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities/${a.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (res.ok) {
        const created: ActivityComment = await res.json();
        setComments((prev) => [...(prev ?? []), created]);
        setCommentText("");
      } else {
        let msg = "Error al comentar";
        try {
          const data = await res.json();
          msg = data.error ?? msg;
        } catch { /* sin body */ }
        setCommentError(msg);
      }
    } catch {
      setCommentError("Error de conexión");
    } finally {
      setCommentSubmitting(false);
    }
  }

  function openEdit() {
    setEditHours(String(Math.floor(a.duration / 60)));
    setEditMinutes(String(a.duration % 60));
    setEditComment("");
    setEditError("");
    setEditing(true);
  }

  async function submitEdit() {
    const hours = Number(editHours) || 0;
    const minutes = Number(editMinutes) || 0;
    if (hours * 60 + minutes <= 0) {
      setEditError("La duración debe ser mayor a 0");
      return;
    }
    if (!editComment.trim()) {
      setEditError("El comentario de modificación es obligatorio");
      return;
    }
    setEditSubmitting(true);
    setEditError("");
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours, minutes, comment: editComment.trim() }),
      });
      if (res.ok) {
        const updated: TaskActivity = await res.json();
        onUpdated(updated);
        setEditing(false);
      } else {
        let msg = "Error al modificar la actividad";
        try {
          const data = await res.json();
          msg = data.error ?? msg;
        } catch { /* sin body */ }
        setEditError(msg);
      }
    } catch {
      setEditError("Error de conexión");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="bg-background rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
            {label}
          </span>
          {reasonArchived && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface2 text-disabled">
              Archivado
            </span>
          )}
          {reasonInactive && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface2 text-disabled">
              Inactivo
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-disabled">{formatActivityDateTime(a.createdAt)}</span>
          {isAdmin && (
            <button
              onClick={openEdit}
              className="p-0.5 text-disabled hover:text-primary transition-colors"
              title="Editar horas (Administrador)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-0.5 text-disabled hover:text-danger transition-colors disabled:opacity-40"
              title="Eliminar actividad"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {(a.isRetroactive || a.modifiedByAdmin) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {a.isRetroactive && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-warning/[.15] text-warning">
              ⚠️ Retroactivo
            </span>
          )}
          {a.modifiedByAdmin && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary-surface text-primary cursor-help"
              title={a.adminComment ? `Comentario del Administrador: ${a.adminComment}` : "Modificado por un Administrador"}
            >
              ✏️ Modificado por Admin
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {a.startTime && a.endTime && (
          <span className="text-xs font-medium text-main">
            {a.startTime} — {a.endTime}
          </span>
        )}
        <span className="text-xs font-semibold text-primary ml-auto">
          {formatDuration(a.duration)}
        </span>
      </div>
      {a.description && (
        <p className="text-xs text-main leading-relaxed">{a.description}</p>
      )}
      <p className="text-[10px] text-disabled">{a.author.name}</p>

      <div className="pt-1 border-t border-border/60">
        <button
          onClick={toggleComments}
          className="flex items-center gap-1 text-[10px] text-secondary hover:text-primary transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {a._count.comments > 0 ? `${a._count.comments} comentario${a._count.comments === 1 ? "" : "s"}` : "Comentar"}
        </button>

        {showComments && (
          <div className="mt-2 space-y-2">
            {commentsLoading && (
              <p className="text-[10px] text-disabled flex items-center gap-1.5">
                <Spinner className="w-3 h-3" /> Cargando comentarios…
              </p>
            )}
            {!commentsLoading && comments && comments.length > 0 && (
              <div className="space-y-1.5">
                {comments.map((c) => (
                  <div key={c.id} className="bg-surface rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-title">{c.author.name}</span>
                      <span className="text-[9px] text-disabled">{formatCommentDateTime(c.createdAt)}</span>
                    </div>
                    <p className="text-[11px] text-main leading-snug mt-0.5">{c.text}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
                placeholder="Escribe un comentario…"
                className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-1.5 text-xs text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <Button
                size="sm"
                onClick={submitComment}
                disabled={!commentText.trim() || commentSubmitting}
              >
                Enviar
              </Button>
            </div>
            {commentError && <p className="text-[10px] text-danger">{commentError}</p>}
          </div>
        )}
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} size="sm">
        <ModalHeader title="Editar horas de la actividad" onClose={() => setEditing(false)} />
        <div className="p-5 space-y-3">
          <div>
            <p className="text-[10px] font-semibold text-secondary uppercase tracking-wide mb-1">Horas actuales</p>
            <p className="text-sm text-title bg-background rounded-lg px-3 py-2">{formatDuration(a.duration)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Nuevas horas</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={23}
                value={editHours}
                onChange={(e) => setEditHours(clampInt(e.target.value, 0, 23))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Nuevos minutos</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={editMinutes}
                onChange={(e) => setEditMinutes(clampInt(e.target.value, 0, 59))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">
              Comentario de modificación
            </label>
            <textarea
              value={editComment}
              onChange={(e) => setEditComment(e.target.value)}
              rows={3}
              placeholder="Explica el motivo de esta modificación"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
            />
          </div>
          {editError && (
            <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{editError}</p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button onClick={submitEdit} disabled={editSubmitting || !editComment.trim()}>
              {editSubmitting ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
