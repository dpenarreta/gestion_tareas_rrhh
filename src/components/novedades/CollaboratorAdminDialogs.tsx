"use client";

import { useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox, Label, TextArea, TextInput } from "./fields";

type Target = { id: number; fullName: string; cedula: string };

// Acciones del Administrador sobre un colaborador (2026-10-16). Django las
// vuelve a autorizar en cada solicitud: estos diálogos solo se muestran al
// Administrador, pero ocultarlos no es la barrera de seguridad.

/** Retirar de Días laborados (eliminación lógica) o restaurar. */
export function WorkedDaysRemovalDialog({
  collaborator,
  restore = false,
  onClose,
  onDone,
}: {
  collaborator: Target;
  restore?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await novedadesApi.post(
      `collaborators/${collaborator.id}/${restore ? "restore-worked-days" : "remove-worked-days"}`,
      { reason },
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(
      restore
        ? `${collaborator.fullName} vuelve a aparecer en Días laborados.`
        : `${collaborator.fullName} fue retirado de Días laborados.`,
      "success",
    );
    onDone();
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={restore ? "Restaurar en Días laborados" : "Retirar de Días laborados"} onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-secondary">
          <strong className="text-title">{collaborator.fullName}</strong> · cédula {collaborator.cedula}
        </p>
        {restore ? (
          <p className="text-xs text-secondary">Volverá a aparecer en Días laborados desde el período en curso.</p>
        ) : (
          <p className="text-xs text-secondary">
            Dejará de aparecer en Días laborados desde el período en curso y no contará en cierres ni exportaciones.{" "}
            <strong>No se borra nada:</strong> se conservan el colaborador, sus días ya registrados, sus horas extras, su
            historial y la auditoría, y se puede restaurar. No cambia su estado ni envía el correo de salida.
          </p>
        )}
        <label className="block">
          <Label hint="obligatorio">Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant={restore ? "primary" : "destructive"}
            onClick={submit}
            loading={saving}
            disabled={!reason.trim()}
          >
            {restore ? "Restaurar" : "Retirar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Corrección administrativa de la cédula. */
export function CedulaDialog({
  collaborator,
  onClose,
  onDone,
}: {
  collaborator: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [cedula, setCedula] = useState(collaborator.cedula);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await novedadesApi.post<{ cedula: string }>(`collaborators/${collaborator.id}/cedula`, {
      cedula,
      reason,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error); // nada se guardó: la cédula sigue siendo la anterior
      return;
    }
    showToast(`Cédula de ${collaborator.fullName} corregida: ${result.data.cedula}.`, "success");
    onDone();
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Corregir cédula" onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-secondary">
          <strong className="text-title">{collaborator.fullName}</strong> · cédula actual {collaborator.cedula}
        </p>
        <label className="block">
          <Label>Cédula correcta</Label>
          <TextInput value={cedula} onChange={(e) => setCedula(e.target.value)} maxLength={40} aria-label="Cédula correcta" />
        </label>
        <label className="block">
          <Label hint="obligatorio">Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <p className="text-xs text-secondary">
          Solo cambia la cédula; sus días, horas extras e historial siguen asociados al mismo colaborador.
        </p>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!reason.trim() || !cedula.trim() || cedula.trim() === collaborator.cedula}>
            Guardar cédula
          </Button>
        </div>
      </div>
    </Modal>
  );
}
