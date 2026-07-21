"use client";

import { useState } from "react";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import { TARGET_TIME_REASON_OPTIONS, TARGET_TIME_REASON_LABEL, type TargetTimeAdjustReason, type HistoricalDeviationInsight } from "@/lib/targetTime";

type Props = {
  taskId: string;
  taskTitle: string;
  currentValue: number;
  historicalDeviation?: HistoricalDeviationInsight;
  onClose: () => void;
  onValidated: (newValue: number) => void;
};

/**
 * Validación del Tiempo Objetivo por líderes (§Sprint 6 S6-C) — nuevo valor +
 * motivo obligatorio, siempre auditado (§S6-G, ver src/lib/targetTimeServer.ts
 * § applyTargetTimeValidation). NUNCA reemplaza el objetivo con horas reales
 * automáticamente (§S6-E) — la Desviación histórica del proceso, si existe,
 * solo se muestra como contexto para que la decisión siga siendo humana.
 */
export default function ValidateTargetTimeModal({ taskId, taskTitle, currentValue, historicalDeviation, onClose, onValidated }: Props) {
  const [newValue, setNewValue] = useState(hoursToDisplay(currentValue));
  const [reason, setReason] = useState<TargetTimeAdjustReason>("PROCEDIMIENTO_ESTANDAR");
  const [reasonDetail, setReasonDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (submitting) return;
    if (!newValue || !validateDisplayHours(newValue)) {
      setError(INVALID_HOURS_MESSAGE);
      return;
    }
    if (reason === "OTRO" && !reasonDetail.trim()) {
      setError('Indica el detalle del motivo cuando eliges "Otro"');
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/target-time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newValue: displayToHours(newValue),
          reason,
          reasonDetail: reason === "OTRO" ? reasonDetail.trim() : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onValidated(data.targetTimeValidated);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Error al validar el tiempo objetivo");
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
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">Validar tiempo objetivo</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-secondary mb-4 truncate">{taskTitle}</p>

        {historicalDeviation?.available && (
          <div className="rounded-xl border border-warning/30 bg-warning/[.08] px-3.5 py-2.5 mb-4">
            <p className="text-xs text-warning leading-relaxed">
              {historicalDeviation.recommendation}
              <span className="block text-[11px] text-disabled mt-1">
                Basado en {historicalDeviation.sampleSize} {historicalDeviation.sampleSize === 1 ? "caso similar" : "casos similares"} (promedio real: {historicalDeviation.avgRealHours}h) — la decisión de ajustar es suya, el sistema no lo hace automáticamente.
              </span>
            </p>
          </div>
        )}

        <div className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Nuevo tiempo objetivo (HH.MM) *</label>
            <input
              type="text"
              inputMode="decimal"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="ej: 6.30 = 6h 30min"
            />
            <p className="text-[11px] text-disabled mt-1">Valor actual: {hoursToDisplay(currentValue)}h</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Motivo del ajuste *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as TargetTimeAdjustReason)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {TARGET_TIME_REASON_OPTIONS.map((r) => (
                <option key={r} value={r}>{TARGET_TIME_REASON_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {reason === "OTRO" && (
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Detalle del motivo *</label>
              <textarea
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                rows={2}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Explica el motivo del ajuste…"
              />
            </div>
          )}

          {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

          <p className="text-[11px] text-disabled">Este cambio queda registrado con tu usuario, rol, fecha y motivo — nunca se elimina el historial.</p>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors">
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {submitting ? "Guardando…" : "Validar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
