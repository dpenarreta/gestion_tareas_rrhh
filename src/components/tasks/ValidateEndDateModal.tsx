"use client";

import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { END_DATE_ACTIONS, type EndDateAction } from "@/lib/endDate";
import { Button } from "@/components/ui/Button";

type Props = {
  taskId: string;
  taskTitle: string;
  currentEndDate: string;
  onClose: () => void;
  onApplied: (result: { endDate: string; endDateApprovalStatus: string }) => void;
};

const ACTION_LABEL: Record<EndDateAction, string> = {
  APROBAR: "Aprobar",
  MODIFICAR: "Modificar",
  RECHAZAR: "Rechazar",
};

/**
 * Validación de Fecha Fin por líderes — Aprobar/Modificar/Rechazar, siempre
 * auditado (ver src/lib/endDateServer.ts § applyEndDateAction). Rechazar NO
 * cambia la fecha (el colaborador debe reproponerla editando la tarea, lo
 * que reinicia el estado a Pendiente automáticamente — ver PATCH
 * /api/tasks/[id]). Mismo patrón visual que ValidateTargetTimeModal.tsx.
 */
export default function ValidateEndDateModal({ taskId, taskTitle, currentEndDate, onClose, onApplied }: Props) {
  const [action, setAction] = useState<EndDateAction>("APROBAR");
  const [newEndDate, setNewEndDate] = useState(formatDate(currentEndDate));
  const [observaciones, setObservaciones] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (submitting) return;
    if (action === "MODIFICAR" && !newEndDate) {
      setError("Selecciona la nueva fecha fin");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/end-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "MODIFICAR" ? { newEndDate } : {}),
          observaciones: observaciones.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onApplied(data);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Error al procesar la Fecha Fin");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">Validar fecha fin</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-secondary mb-4 truncate">{taskTitle}</p>
        <p className="text-[11px] text-disabled mb-4">Fecha fin actual: {formatDate(currentEndDate)}</p>

        <div className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Acción *</label>
            <div className="flex gap-2">
              {END_DATE_ACTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAction(a)}
                  className={`flex-1 text-xs px-3 py-2 rounded-xl border transition-colors ${
                    action === a ? "border-primary bg-primary-surface text-primary font-medium" : "border-border text-secondary hover:bg-surface2"
                  }`}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>
          </div>

          {action === "MODIFICAR" && (
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Nueva fecha fin *</label>
              <input
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {action === "RECHAZAR" && (
            <p className="text-[11px] text-warning bg-warning/[.08] rounded-lg px-3 py-2">
              La fecha actual no se modifica — el colaborador deberá proponer una nueva fecha editando la tarea.
            </p>
          )}

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Observaciones (opcional)</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              placeholder="Explica tu decisión…"
            />
          </div>

          {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

          <p className="text-[11px] text-disabled">Este cambio queda registrado con tu usuario, rol y fecha — nunca se elimina el historial.</p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Guardando…" : ACTION_LABEL[action]}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
