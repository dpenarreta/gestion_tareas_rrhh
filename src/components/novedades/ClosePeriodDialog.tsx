"use client";

import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox } from "./fields";
import type { CloseSummary } from "./types";

type Props = { period: string; supervisorId: number; onClose: () => void; onClosed: () => void };

export default function ClosePeriodDialog({ period, supervisorId, onClose, onClosed }: Props) {
  const { showToast } = useToast();
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    novedadesApi.get<CloseSummary>("periods/close-summary", { period, supervisor: supervisorId }).then((r) => {
      if (r.ok) setSummary(r.data);
      else setError(r.error);
    });
  }, [period, supervisorId]);

  async function close() {
    setSaving(true);
    setError(null);
    const result = await novedadesApi.post<{ alreadyClosed: boolean; nextPeriod: string | null }>("periods/close", {
      period,
      supervisorId,
      confirm: true,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(
      result.data.alreadyClosed
        ? "El período ya estaba cerrado."
        : `Período cerrado. Se habilitó el siguiente período (${result.data.nextPeriod}).`,
      "success",
    );
    onClosed();
  }

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title="Cerrar período" onClose={onClose} />
      <div className="p-5 space-y-4">
        {!summary && !error && (
          <div className="flex justify-center py-6">
            <Spinner className="text-primary" />
          </div>
        )}
        {summary && (
          <>
            <p className="text-sm text-secondary">
              Cierre de <strong className="text-title">{summary.periodLabel}</strong> para{" "}
              <strong className="text-title">{summary.supervisorName}</strong>. Solo afecta a este equipo: los demás
              supervisores siguen trabajando.
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-surface2 rounded-lg p-3">
              <dt className="text-secondary">Colaboradores activos</dt>
              <dd className="text-right font-semibold">{summary.activeCollaborators}</dd>
              <dt className="text-secondary">Celdas con horas</dt>
              <dd className="text-right font-semibold">{summary.workedDayCells}</dd>
              <dt className="text-secondary">Celdas reportadas en 0</dt>
              <dd className="text-right font-semibold">{summary.zeroCells}</dd>
              <dt className="text-secondary">Celdas pendientes (vacías, días hábiles)</dt>
              <dd className={`text-right font-semibold ${summary.pendingCells ? "text-warning" : ""}`}>
                {summary.pendingCells}
              </dd>
              <dt className="text-secondary">Horas laboradas</dt>
              <dd className="text-right font-semibold">{summary.workedHours}</dd>
              <dt className="text-secondary">Registros de horas extras</dt>
              <dd className="text-right font-semibold">{summary.overtimeRecords}</dd>
              <dt className="text-secondary">Horas extras / sábado</dt>
              <dd className="text-right font-semibold">
                {summary.overtimeHours} / {summary.saturdayHours}
              </dd>
            </dl>
            {summary.pendingCells > 0 && (
              <p className="text-xs text-warning">
                Hay celdas vacías en días hábiles. Vacío significa “no reportado”, distinto de 0.
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
              <span>
                Revisé la información. Entiendo que, al cerrar, los registros de este período quedan bloqueados y solo
                podrán corregirse mediante el procedimiento autorizado.
              </span>
            </label>
          </>
        )}
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={close} loading={saving} disabled={!summary || !confirmed}>
            Cerrar período
          </Button>
        </div>
      </div>
    </Modal>
  );
}
