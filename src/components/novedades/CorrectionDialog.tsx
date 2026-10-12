"use client";

import { useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox, Label, TextArea, TextInput } from "./fields";

type Props = {
  target: "WORKED_DAY" | "OVERTIME";
  title: string;
  currentValue: string;
  payload: Record<string, unknown>;
  /** Solo para horas extras: permite anular el registro en lugar de cambiar horas. */
  allowDelete?: boolean;
  onClose: () => void;
  onDone: () => void;
};

// Corrección excepcional sobre un período ya cerrado: siempre con motivo,
// conserva el valor original y queda en el historial (procedimiento
// autorizado, solo Administrador con `novedades.corregir_cerrado`).
export default function CorrectionDialog({ target, title, currentValue, payload, allowDelete, onClose, onDone }: Props) {
  const { showToast } = useToast();
  const [value, setValue] = useState(currentValue);
  const [remove, setRemove] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    const body =
      target === "WORKED_DAY"
        ? { ...payload, hours: value.trim() === "" ? null : value.replace(",", "."), reason }
        : { ...payload, overtimeHours: value.replace(",", "."), delete: remove, reason };
    const result = await novedadesApi.post(target === "WORKED_DAY" ? "corrections/worked-day" : "corrections/overtime", body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast("Corrección registrada.", "success");
    onDone();
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Corrección de período cerrado" onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-secondary">{title}</p>
        <p className="text-xs text-secondary">
          Valor original: <strong>{currentValue || "vacío"}</strong> — se conserva en el historial.
        </p>
        {!remove && (
          <label className="block">
            <Label>{target === "WORKED_DAY" ? "Nuevo valor (horas, vacío = sin reporte)" : "# Horas extras"}</Label>
            <TextInput value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </label>
        )}
        {allowDelete && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Anular el registro
          </label>
        )}
        <label className="block">
          <Label hint="obligatorio">Motivo de la corrección</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!reason.trim()}>
            Registrar corrección
          </Button>
        </div>
      </div>
    </Modal>
  );
}
