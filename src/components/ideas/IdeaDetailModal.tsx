"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import { canReviewIdeas, ROLE_LABEL } from "@/lib/roles";
import type { IdeaDetail, Idea } from "./types";
import { IMPACT_LABELS, IMPACT_STYLES, STATUS_INFO } from "./constants";
import { formatDate } from "@/lib/utils";

type Props = {
  ideaId: string;
  currentUserRole: Role;
  onClose: () => void;
  onUpdated: (idea: Idea) => void;
};

function formatDateTime(iso: string) {
  const time = new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${formatDate(iso)} ${time}`;
}

export default function IdeaDetailModal({ ideaId, currentUserRole, onClose, onUpdated }: Props) {
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [progressDraft, setProgressDraft] = useState(0);
  const [savingProgress, setSavingProgress] = useState(false);

  const canReview = canReviewIdeas(currentUserRole);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/ideas/${ideaId}`);
    if (res.ok) {
      const data: IdeaDetail = await res.json();
      setIdea(data);
      setProgressDraft(data.progress);
    }
    setLoading(false);
  }

  async function handleSaveProgress() {
    setSavingProgress(true);
    setError("");
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: progressDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al actualizar el progreso");
        return;
      }
      onUpdated(data);
      await load();
    } finally {
      setSavingProgress(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideaId]);

  async function runAction(action: "ADVANCE" | "RETREAT" | "REJECT" | "REOPEN", actionComment?: string) {
    setActing(true);
    setError("");
    try {
      const res = await fetch(`/api/ideas/${ideaId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: actionComment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al actualizar la idea");
        return;
      }
      onUpdated(data);
      setComment("");
      setRejectMode(false);
      setRejectReason("");
      await load();
    } finally {
      setActing(false);
    }
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      setError("El motivo del rechazo es obligatorio");
      return;
    }
    runAction("REJECT", rejectReason.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-title">Detalle de la idea</h2>
          <button onClick={onClose} className="p-2 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && <div className="p-10 text-center text-disabled text-sm">Cargando...</div>}

        {!loading && idea && (
          <div className="p-6 space-y-5">
            {error && (
              <div className="text-sm text-danger bg-danger/[.09] rounded-xl px-4 py-2.5">
                {error}
              </div>
            )}

            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-title">{idea.title}</h3>
                <p className="text-xs text-disabled mt-1">
                  Propuesta por {idea.author.name} · {ROLE_LABEL[idea.author.role as Role] ?? idea.author.role}
                </p>
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_INFO[idea.status].headerBg} ${STATUS_INFO[idea.status].headerText}`}>
                {STATUS_INFO[idea.status].emoji} {STATUS_INFO[idea.status].label}
              </span>
            </div>

            <p className="text-sm text-main whitespace-pre-wrap">{idea.description}</p>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${IMPACT_STYLES[idea.impact]}`}>
                Impacto {IMPACT_LABELS[idea.impact]}
              </span>
              <span className="text-[10px] text-disabled">Propuesta el {formatDateTime(idea.createdAt)}</span>
            </div>

            {idea.status === "EN_DESARROLLO" && (
              <div className="bg-surface2 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Progreso</span>
                  <span className="text-sm font-bold text-title">{idea.progress}%</span>
                </div>
                <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${idea.progress}%` }}
                  />
                </div>
                {canReview && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={progressDraft}
                      onChange={(e) => setProgressDraft(Math.min(100, Math.max(0, Number(e.target.value))))}
                      className="w-20 border border-border2 rounded-[10px] px-2.5 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary-surface"
                    />
                    <button
                      onClick={handleSaveProgress}
                      disabled={savingProgress || progressDraft === idea.progress}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-[9px] hover:brightness-110 disabled:opacity-50 transition-all"
                    >
                      {savingProgress ? "Guardando..." : "Actualizar progreso"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {idea.status === "PROPUESTA" && idea.attachmentData && (
              <a
                href={idea.attachmentData}
                download={idea.attachmentUrl ?? "adjunto"}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                📎 Ver adjunto{idea.attachmentUrl ? `: ${idea.attachmentUrl}` : ""}
              </a>
            )}

            <div>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Historial de etapas</p>
              {idea.history.length === 0 && <p className="text-sm text-disabled">Sin cambios de etapa todavía.</p>}
              <ul className="space-y-2.5">
                {[...idea.history].reverse().map((h) => (
                  <li key={h.id} className="text-sm border-l-2 border-border pl-3">
                    <p className="text-main">
                      {STATUS_INFO[h.fromStatus].emoji} {STATUS_INFO[h.fromStatus].label} → {STATUS_INFO[h.toStatus].emoji} {STATUS_INFO[h.toStatus].label}
                    </p>
                    <p className="text-[11px] text-disabled">{h.changer.name} · {formatDateTime(h.createdAt)}</p>
                    {h.comment && (
                      <p className="text-xs text-main mt-1 bg-background rounded-lg px-2.5 py-1.5">{h.comment}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {canReview && idea.status !== "IMPLEMENTADA" && (
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Acciones</p>

                {!rejectMode ? (
                  <>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      placeholder="Comentario opcional para esta transición"
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    />
                    <div className="flex flex-wrap gap-2">
                      {idea.status !== "RECHAZADA" && idea.status !== "PROPUESTA" && (
                        <button
                          disabled={acting}
                          onClick={() => runAction("RETREAT", comment.trim() || undefined)}
                          className="px-4 py-2 text-sm font-medium text-main border border-border rounded-xl hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                        >
                          ← Retroceder
                        </button>
                      )}
                      {idea.status !== "RECHAZADA" && (
                        <button
                          disabled={acting}
                          onClick={() => runAction("ADVANCE", comment.trim() || undefined)}
                          className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary-hover disabled:opacity-50"
                        >
                          Avanzar →
                        </button>
                      )}
                      {idea.status !== "RECHAZADA" && (
                        <button
                          disabled={acting}
                          onClick={() => setRejectMode(true)}
                          className="px-4 py-2 text-sm font-medium text-danger border border-transparent rounded-xl hover:bg-danger/[.09] disabled:opacity-50"
                        >
                          ❌ Rechazar
                        </button>
                      )}
                      {idea.status === "RECHAZADA" && (
                        <button
                          disabled={acting}
                          onClick={() => runAction("REOPEN", comment.trim() || undefined)}
                          className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary-hover disabled:opacity-50"
                        >
                          Reabrir
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      placeholder="Motivo del rechazo (obligatorio)"
                      className="w-full border border-danger/40 rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={acting}
                        onClick={handleReject}
                        className="px-4 py-2 text-sm font-medium text-white bg-danger rounded-xl hover:brightness-110 disabled:opacity-50"
                      >
                        Confirmar rechazo
                      </button>
                      <button
                        disabled={acting}
                        onClick={() => { setRejectMode(false); setRejectReason(""); }}
                        className="px-4 py-2 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
