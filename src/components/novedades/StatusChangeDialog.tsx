"use client";

import { useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox, Label, SelectInput, TextArea } from "./fields";
import { STATUS_LABEL, type CollaboratorStatus } from "./types";

type ExitMailStatus = "PENDING" | "SENDING" | "SENT" | "FAILED";

const EXIT_MAIL_LABEL: Record<ExitMailStatus, string> = {
  PENDING: "Notificación pendiente de envío.",
  SENDING: "Notificación pendiente de envío.",
  SENT: "Notificación enviada.",
  FAILED: "Error en la notificación: el Administrador puede reintentarla desde Ajustes.",
};

type Props = {
  collaborator: { id: number; fullName: string; status: CollaboratorStatus };
  onClose: () => void;
  onDone: () => void;
};

export default function StatusChangeDialog({ collaborator, onClose, onDone }: Props) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<CollaboratorStatus>(collaborator.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const needsReason = status !== "ACTIVE";
  // Activo → Inactivo y Activo → Suspendido envían su correo (contenido distinto).
  const mailKind =
    collaborator.status === "ACTIVE" && status === "INACTIVE"
      ? "de salida"
      : collaborator.status === "ACTIVE" && status === "SUSPENDED"
        ? "de suspensión"
        : null;

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await novedadesApi.post<{ exitNotification?: { status: ExitMailStatus } }>(
      `collaborators/${collaborator.id}/status`,
      { status, reason },
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // El cambio de estado ya está confirmado; el correo de salida tiene su
    // propio estado y una falla del correo no se presenta como falla del cambio.
    const mail = result.data?.exitNotification;
    showToast(
      `Cambio de estado confirmado: ${collaborator.fullName} — ${STATUS_LABEL[status]}.${mail ? ` ${EXIT_MAIL_LABEL[mail.status]}` : ""}`,
      mail?.status === "FAILED" ? "warning" : "success",
    );
    onDone();
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Cambiar estado operativo" onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-secondary">
          {collaborator.fullName} · estado actual: <strong>{STATUS_LABEL[collaborator.status]}</strong>
        </p>
        <label className="block">
          <Label>Nuevo estado</Label>
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value as CollaboratorStatus)}>
            {(Object.keys(STATUS_LABEL) as CollaboratorStatus[])
              .filter((s) => s !== collaborator.status)
              .map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
          </SelectInput>
        </label>
        <label className="block">
          <Label hint={needsReason ? "obligatorio" : "opcional"}>Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {needsReason && (
          <p className="text-xs text-secondary">
            El historial y las horas ya registradas se conservan. Se notificará al Administrador de inmediato.
            {mailKind && ` Además se enviará por correo la notificación ${mailKind} con el detalle de Días laborados del período.`}
          </p>
        )}
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant={needsReason ? "destructive" : "primary"}
            onClick={submit}
            loading={saving}
            disabled={needsReason && !reason.trim()}
          >
            Confirmar cambio
          </Button>
        </div>
      </div>
    </Modal>
  );
}
