"use client";

import { useState, useEffect, useMemo } from "react";
import type { Role } from "@/generated/prisma/client";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import { formatDate } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/roles";
import {
  TARGET_TIME_REASON_OPTIONS,
  TARGET_TIME_REASON_LABEL,
  type TargetTimeAdjustReason,
  type HistoricalDeviationInsight,
} from "@/lib/targetTime";
import {
  END_DATE_ACTIONS,
  END_DATE_STATUS_LABEL,
  END_DATE_STATUS_EMOJI,
  END_DATE_BADGE_CLASS,
  END_DATE_AUDIT_ACTION_LABEL,
  type EndDateAction,
  type EndDateApprovalStatus,
  type EndDateAuditAction,
} from "@/lib/endDate";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";

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
  isValidated: boolean;
  officialTarget: number;
  realHours: number;
  deviation: { hours: number; pct: number | null };
  validatedBy: { id: string; name: string } | null;
  canValidate: boolean;
  auditHistory: TargetTimeAuditEntry[];
  historicalDeviation: HistoricalDeviationInsight;
};

type EndDateAuditEntry = {
  id: string;
  action: EndDateAuditAction;
  previousValue: string | null;
  newValue: string | null;
  observaciones: string | null;
  user: { id: string; name: string };
  userRole: string;
  createdAt: string;
};

type EndDateInfo = {
  endDate: string;
  endDateApprovalStatus: EndDateApprovalStatus;
  approvedBy: { id: string; name: string } | null;
  canValidate: boolean;
  auditHistory: EndDateAuditEntry[];
};

function formatAuditDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${mins}`;
}

type Props = {
  taskId: string;
  taskTitle: string;
  assignedToName?: string;
  startDate?: string;
  onClose: () => void;
  /** Llamado tras CUALQUIER cambio aplicado (Tiempo Objetivo o Fecha Fin, cada uno independiente) — para que la lista/panel que abrió el modal se refresque. */
  onChanged?: () => void;
};

/**
 * Validación de actividad — punto único donde el líder revisa AMBAS
 * validaciones (Tiempo Objetivo y Fecha Fin) de una tarea, cada una con su
 * propia acción independiente (aprobar una y rechazar la otra, por
 * ejemplo). Reemplaza los 2 modales separados (ValidateTargetTimeModal.tsx/
 * ValidateEndDateModal.tsx) — la sección de Tiempo Objetivo mantiene
 * exactamente el mismo comportamiento/API que tenía (valor + motivo,
 * POST /target-time); la de Fecha Fin, Aprobar/Modificar/Rechazar +
 * observaciones (POST /end-date). Ninguna de las 2 APIs ni su lógica de
 * validación cambia — esto es solo la capa de presentación combinada.
 */
export default function ValidateActivityModal({ taskId, taskTitle, assignedToName, startDate, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [targetTimeInfo, setTargetTimeInfo] = useState<TargetTimeInfo | null>(null);
  const [endDateInfo, setEndDateInfo] = useState<EndDateInfo | null>(null);

  const load = useMemo(
    () => () => {
      setLoading(true);
      return Promise.all([
        fetch(`/api/tasks/${taskId}/target-time`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/tasks/${taskId}/end-date`).then((r) => (r.ok ? r.json() : null)),
      ])
        .then(([tt, ed]) => {
          setTargetTimeInfo(tt);
          setEndDateInfo(ed);
        })
        .finally(() => setLoading(false));
    },
    [taskId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // ── Sección Tiempo Objetivo — mismo comportamiento/API que ValidateTargetTimeModal.tsx ──
  const [ttValue, setTtValue] = useState("");
  const [ttReason, setTtReason] = useState<TargetTimeAdjustReason>("PROCEDIMIENTO_ESTANDAR");
  const [ttReasonDetail, setTtReasonDetail] = useState("");
  const [ttSubmitting, setTtSubmitting] = useState(false);
  const [ttError, setTtError] = useState("");
  const [ttHistoryOpen, setTtHistoryOpen] = useState(false);

  useEffect(() => {
    if (targetTimeInfo) setTtValue(hoursToDisplay(targetTimeInfo.officialTarget));
  }, [targetTimeInfo]);

  async function submitTargetTime() {
    if (ttSubmitting) return;
    if (!ttValue || !validateDisplayHours(ttValue)) {
      setTtError(INVALID_HOURS_MESSAGE);
      return;
    }
    if (ttReason === "OTRO" && !ttReasonDetail.trim()) {
      setTtError('Indica el detalle del motivo cuando eliges "Otro"');
      return;
    }
    setTtError("");
    setTtSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/target-time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newValue: displayToHours(ttValue),
          reason: ttReason,
          reasonDetail: ttReason === "OTRO" ? ttReasonDetail.trim() : null,
        }),
      });
      if (res.ok) {
        await load();
        onChanged?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setTtError(data.error ?? "Error al validar el tiempo objetivo");
      }
    } finally {
      setTtSubmitting(false);
    }
  }

  // ── Sección Fecha Fin — mismo comportamiento/API que ValidateEndDateModal.tsx ──
  const [edAction, setEdAction] = useState<EndDateAction>("APROBAR");
  const [edNewDate, setEdNewDate] = useState("");
  const [edObservaciones, setEdObservaciones] = useState("");
  const [edSubmitting, setEdSubmitting] = useState(false);
  const [edError, setEdError] = useState("");
  const [edHistoryOpen, setEdHistoryOpen] = useState(false);

  useEffect(() => {
    if (endDateInfo) setEdNewDate(formatDate(endDateInfo.endDate));
  }, [endDateInfo]);

  async function submitEndDate() {
    if (edSubmitting) return;
    if (edAction === "MODIFICAR" && !edNewDate) {
      setEdError("Selecciona la nueva fecha fin");
      return;
    }
    setEdError("");
    setEdSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/end-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: edAction,
          ...(edAction === "MODIFICAR" ? { newEndDate: edNewDate } : {}),
          observaciones: edObservaciones.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEdObservaciones("");
        await load();
        onChanged?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setEdError(data.error ?? "Error al procesar la fecha fin");
      }
    } finally {
      setEdSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-[14px] shadow-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-title uppercase tracking-wider">Validación de actividad</h3>
          <button onClick={onClose} className="text-disabled hover:text-main transition-colors" aria-label="Cerrar">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-title font-medium mt-2 truncate">{taskTitle}</p>
        {(assignedToName || startDate) && (
          <div className="flex flex-wrap gap-x-4 text-[11px] text-secondary mt-1 mb-4">
            {assignedToName && (
              <p>
                Responsable: <span className="text-main">{assignedToName}</span>
              </p>
            )}
            {startDate && (
              <p>
                Fecha inicio: <span className="text-main">{formatDate(startDate)}</span>
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-8">
            <Spinner className="w-5 h-5 text-primary" />
          </div>
        )}

        {!loading && targetTimeInfo && (
          <section className="mb-5 pb-5 border-b border-border">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs font-semibold text-main uppercase tracking-wide">Tiempo Objetivo</h4>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                  targetTimeInfo.isValidated ? "bg-success/[.13] text-success" : "bg-warning/[.15] text-warning"
                }`}
              >
                {targetTimeInfo.isValidated ? "Validado" : "Pendiente"}
              </span>
            </div>

            <div className="space-y-1 text-xs mb-3">
              <p className="text-secondary">
                Valor propuesto: <span className="text-title font-semibold">{hoursToDisplay(targetTimeInfo.officialTarget)}h</span>
              </p>
              {targetTimeInfo.realHours > 0 && (
                <p className="text-secondary">
                  Desviación:{" "}
                  <span
                    className={
                      targetTimeInfo.deviation.hours > 0 ? "text-danger" : targetTimeInfo.deviation.hours < 0 ? "text-success" : "text-disabled"
                    }
                  >
                    {targetTimeInfo.deviation.hours > 0 ? "+" : ""}
                    {targetTimeInfo.deviation.hours}h
                    {targetTimeInfo.deviation.pct !== null && ` (${targetTimeInfo.deviation.pct > 0 ? "+" : ""}${targetTimeInfo.deviation.pct}%)`}
                  </span>
                </p>
              )}
            </div>

            {targetTimeInfo.historicalDeviation.available && (
              <p className="text-[11px] text-warning bg-warning/[.08] rounded-lg px-2.5 py-2 mb-3 leading-relaxed">
                {targetTimeInfo.historicalDeviation.recommendation}
              </p>
            )}

            {targetTimeInfo.canValidate ? (
              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs font-semibold text-main mb-1.5">Nuevo tiempo objetivo (HH.MM) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={ttValue}
                    onChange={(e) => setTtValue(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="ej: 6.30 = 6h 30min"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-main mb-1.5">Motivo del ajuste *</label>
                  <select
                    value={ttReason}
                    onChange={(e) => setTtReason(e.target.value as TargetTimeAdjustReason)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {TARGET_TIME_REASON_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {TARGET_TIME_REASON_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
                {ttReason === "OTRO" && (
                  <div>
                    <label className="block text-xs font-semibold text-main mb-1.5">Detalle del motivo *</label>
                    <textarea
                      value={ttReasonDetail}
                      onChange={(e) => setTtReasonDetail(e.target.value)}
                      rows={2}
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    />
                  </div>
                )}
                {ttError && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{ttError}</p>}
                <div className="flex justify-end">
                  <Button size="sm" onClick={submitTargetTime} disabled={ttSubmitting}>
                    {ttSubmitting ? "Guardando…" : "Validar"}
                  </Button>
                </div>
              </div>
            ) : (
              targetTimeInfo.validatedBy && <p className="text-[11px] text-disabled">Validado por {targetTimeInfo.validatedBy.name}.</p>
            )}

            {targetTimeInfo.auditHistory.length > 0 && (
              <div className="mt-3">
                <Button variant="tertiary" size="sm" onClick={() => setTtHistoryOpen((v) => !v)}>
                  {ttHistoryOpen ? "Ocultar" : "Ver"} historial ({targetTimeInfo.auditHistory.length})
                </Button>
                {ttHistoryOpen && (
                  <div className="space-y-1.5 mt-2">
                    {targetTimeInfo.auditHistory.map((a) => (
                      <div key={a.id} className="bg-background rounded-lg px-2.5 py-2 text-[11px] space-y-0.5">
                        <p className="text-title font-medium">
                          {a.previousValue !== null ? `${hoursToDisplay(a.previousValue)}h → ` : ""}
                          {hoursToDisplay(a.newValue)}h
                        </p>
                        <p className="text-secondary">
                          {TARGET_TIME_REASON_LABEL[a.reason]}
                          {a.reasonDetail ? `: ${a.reasonDetail}` : ""}
                        </p>
                        <p className="text-disabled">
                          {a.user.name} ({ROLE_LABEL[a.userRole as Role] ?? a.userRole}) · {formatAuditDateTime(a.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {!loading && endDateInfo && (
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs font-semibold text-main uppercase tracking-wide">Fecha Fin</h4>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${END_DATE_BADGE_CLASS[endDateInfo.endDateApprovalStatus]}`}
              >
                {END_DATE_STATUS_EMOJI[endDateInfo.endDateApprovalStatus]} {END_DATE_STATUS_LABEL[endDateInfo.endDateApprovalStatus]}
              </span>
            </div>

            <p className="text-xs text-secondary mb-3">
              Fecha propuesta: <span className="text-title font-semibold">{formatDate(endDateInfo.endDate)}</span>
            </p>

            {endDateInfo.canValidate ? (
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  {END_DATE_ACTIONS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setEdAction(a)}
                      className={`flex-1 text-xs px-3 py-2 rounded-xl border transition-colors ${
                        edAction === a ? "border-primary bg-primary-surface text-primary font-medium" : "border-border text-secondary hover:bg-surface2"
                      }`}
                    >
                      {a === "APROBAR" ? "Aprobar" : a === "MODIFICAR" ? "Modificar" : "Rechazar"}
                    </button>
                  ))}
                </div>

                {edAction === "MODIFICAR" && (
                  <div>
                    <label className="block text-xs font-semibold text-main mb-1.5">Nueva fecha fin *</label>
                    <input
                      type="date"
                      value={edNewDate}
                      onChange={(e) => setEdNewDate(e.target.value)}
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                )}

                {edAction === "RECHAZAR" && (
                  <p className="text-[11px] text-warning bg-warning/[.08] rounded-lg px-3 py-2">
                    La fecha actual no se modifica — el colaborador deberá proponer una nueva fecha editando la tarea.
                  </p>
                )}

                <div>
                  <label className="block text-xs font-semibold text-main mb-1.5">Observaciones (opcional)</label>
                  <textarea
                    value={edObservaciones}
                    onChange={(e) => setEdObservaciones(e.target.value)}
                    rows={2}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    placeholder="Explica tu decisión…"
                  />
                </div>

                {edError && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{edError}</p>}

                <div className="flex justify-end">
                  <Button size="sm" onClick={submitEndDate} disabled={edSubmitting}>
                    {edSubmitting ? "Guardando…" : edAction === "APROBAR" ? "Aprobar" : edAction === "MODIFICAR" ? "Modificar" : "Rechazar"}
                  </Button>
                </div>
              </div>
            ) : (
              endDateInfo.approvedBy && (
                <p className="text-[11px] text-disabled">
                  {END_DATE_STATUS_LABEL[endDateInfo.endDateApprovalStatus]} por {endDateInfo.approvedBy.name}.
                </p>
              )
            )}

            {endDateInfo.auditHistory.length > 0 && (
              <div className="mt-3">
                <Button variant="tertiary" size="sm" onClick={() => setEdHistoryOpen((v) => !v)}>
                  {edHistoryOpen ? "Ocultar" : "Ver"} historial ({endDateInfo.auditHistory.length})
                </Button>
                {edHistoryOpen && (
                  <div className="space-y-1.5 mt-2">
                    {endDateInfo.auditHistory.map((a) => (
                      <div key={a.id} className="bg-background rounded-lg px-2.5 py-2 text-[11px] space-y-0.5">
                        <p className="text-title font-medium">
                          {END_DATE_AUDIT_ACTION_LABEL[a.action]}
                          {a.previousValue && a.newValue && a.previousValue !== a.newValue
                            ? `: ${formatDate(a.previousValue)} → ${formatDate(a.newValue)}`
                            : a.newValue
                              ? `: ${formatDate(a.newValue)}`
                              : ""}
                        </p>
                        {a.observaciones && <p className="text-secondary">{a.observaciones}</p>}
                        <p className="text-disabled">
                          {a.user.name} ({ROLE_LABEL[a.userRole as Role] ?? a.userRole}) · {formatAuditDateTime(a.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <p className="text-[11px] text-disabled mt-4">Cada cambio queda registrado con tu usuario, rol y fecha — nunca se elimina el historial.</p>

        <div className="flex justify-end pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
