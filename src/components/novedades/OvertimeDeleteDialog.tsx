"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatDate, novedadesApi } from "./api";
import { ErrorBox, Label, TextArea } from "./fields";

export type OvertimeDeleteTarget = {
  id: number;
  fullName: string;
  cedula: string;
  date: string;
  overtimeHours: string;
  saturdayHours: string;
};

/** Confirmación para eliminar un registro de horas extras YA GUARDADO (la
 * consulta y la captura masiva la comparten). Borrado lógico en Django: el
 * colaborador sigue en la base y el Administrador recibe una alerta roja.
 * `onDone(alreadyGone)` avisa si otro usuario ya lo había eliminado (404). */
export default function OvertimeDeleteDialog({
  record,
  onClose,
  onDone,
}: {
  record: OvertimeDeleteTarget;
  onClose: () => void;
  onDone: (alreadyGone: boolean) => void;
}) {
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Bloqueo síncrono: un doble clic llega antes de que React vuelva a pintar
  // el botón deshabilitado, así que el estado solo no alcanza.
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const result = await novedadesApi.del(`overtime/${record.id}`, { reason: reason.trim() });
    setSaving(false);
    inFlight.current = false;
    if (result.ok) {
      showToast("Registro eliminado. El colaborador sigue en la base.", "success");
      onDone(false);
    } else if (result.status === 404) {
      showToast("El registro ya no existe (otro usuario lo eliminó). Se quitó de la tabla.", "info");
      onDone(true);
    } else {
      setError(result.error);
    }
  }

  const hours = [
    record.overtimeHours && record.overtimeHours !== "0" ? `${record.overtimeHours} h extra` : "",
    record.saturdayHours && record.saturdayHours !== "0" ? `${record.saturdayHours} h sábado` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal open onClose={saving ? () => {} : onClose} size="sm">
      <ModalHeader title="Eliminar registro de horas extras" onClose={onClose} />
      <div className="p-5 space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 bg-surface2 rounded-lg p-3 text-sm">
          <dt className="text-secondary">Colaborador</dt>
          <dd className="font-semibold">{record.fullName}</dd>
          <dt className="text-secondary">Cédula</dt>
          <dd className="font-mono">{record.cedula}</dd>
          <dt className="text-secondary">Fecha</dt>
          <dd>{formatDate(record.date)}</dd>
          {hours && (
            <>
              <dt className="text-secondary">Horas</dt>
              <dd>{hours}</dd>
            </>
          )}
        </dl>
        <p className="text-sm text-secondary">
          Solo se elimina este registro: el colaborador <strong>sigue en la base oficial</strong>. Queda en el historial
          (eliminación lógica) y se alerta al Administrador.
        </p>
        <label className="block">
          <Label hint="opcional">Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" loading={saving} disabled={saving} onClick={confirm}>
            Eliminar registro
          </Button>
        </div>
      </div>
    </Modal>
  );
}
