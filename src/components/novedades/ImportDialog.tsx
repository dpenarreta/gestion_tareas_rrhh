"use client";

import { useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox, Label, SelectInput } from "./fields";
import type { ImportBatch } from "./types";

type Props = {
  kind: "WORKED_DAYS" | "OVERTIME";
  period: string;
  onClose: () => void;
  onImported: () => void;
};

const TEMPLATE_HINT: Record<Props["kind"], string> = {
  WORKED_DAYS: "Supervisor | Cargo | Corte anterior | Cédula | Empleado | una columna por fecha del período",
  OVERTIME:
    "FECHA | CEDULA | NOMBRE DEL COLABORADOR | REGIONAL | ÁREA | CARGO | # HORAS EXTRAS | # HORAS SABADO | SABADO | DOMINGO | FERIADO | TRABAJO REALIZADO | OBSERVACIONES",
};

export default function ImportDialog({ kind, period, onClose, onImported }: Props) {
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [strategy, setStrategy] = useState<"skip" | "update">("skip");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("period", period);
    form.set("file", file);
    const result = await novedadesApi.upload<ImportBatch>("imports/preview", form);
    setBusy(false);
    if (result.ok) setBatch(result.data);
    else setError(result.error);
  }

  async function confirm() {
    if (!batch) return;
    setBusy(true);
    setError(null);
    const result = await novedadesApi.post<ImportBatch>(`imports/${batch.id}/confirm`, { strategy });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(
      `Importación aplicada: ${result.data.summary.applied ?? 0} aplicados, ${result.data.summary.skipped ?? 0} omitidos.`,
      "success",
    );
    onImported();
  }

  async function cancel() {
    if (batch) await novedadesApi.post(`imports/${batch.id}/cancel`);
    onClose();
  }

  return (
    <Modal open onClose={cancel} size="lg">
      <ModalHeader title={kind === "WORKED_DAYS" ? "Importar Días laborados" : "Importar Horas extras"} onClose={cancel} />
      <div className="p-5 space-y-4">
        {!batch ? (
          <>
            <p className="text-sm text-secondary">
              Período <strong>{period}</strong>. El archivo (.xlsx) debe tener los encabezados:
            </p>
            <p className="text-xs font-mono bg-surface2 rounded-lg p-2 break-words">{TEMPLATE_HINT[kind]}</p>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm"
            />
            <p className="text-xs text-secondary">
              Primero se muestra una vista previa: no se guarda nada hasta que confirme.
            </p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-sm">
              {[
                ["Filas válidas", batch.summary.validRows, "text-success"],
                ["Filas con error", batch.summary.invalidRows, "text-danger"],
                ["Nuevos", batch.summary.newItems, "text-title"],
                ["Ya existentes", batch.summary.existingItems, "text-warning"],
              ].map(([label, value, color]) => (
                <div key={label as string} className="bg-surface2 rounded-lg p-2">
                  <div className={`text-lg font-bold ${color}`}>{value as number}</div>
                  <div className="text-xs text-secondary">{label}</div>
                </div>
              ))}
            </div>
            {batch.summary.alreadyImported && (
              <p className="text-sm text-warning">
                Este mismo archivo ya se importó en este período. Si continúa, no se duplicarán registros.
              </p>
            )}
            {batch.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-danger">Errores ({batch.errors.length})</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      novedadesApi.download(`imports/${batch.id}/errors`, {}, `errores-importacion-${batch.id}.xlsx`)
                    }
                  >
                    Descargar reporte
                  </Button>
                </div>
                <ul className="max-h-48 overflow-y-auto text-xs space-y-1 border border-border rounded-lg p-2">
                  {batch.errors.slice(0, 200).map((e, i) => (
                    <li key={i}>
                      <span className="font-semibold">Fila {e.row}</span>
                      {e.column ? ` · ${e.column}` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {batch.summary.existingItems > 0 && (
              <label className="block max-w-sm">
                <Label>Registros que ya existen</Label>
                <SelectInput value={strategy} onChange={(e) => setStrategy(e.target.value as "skip" | "update")}>
                  <option value="skip">Omitirlos (no modificar lo existente)</option>
                  <option value="update">Actualizarlos con el valor del archivo</option>
                </SelectInput>
              </label>
            )}
            {batch.summary.validRows === 0 && (
              <p className="text-sm text-secondary">No hay filas válidas para importar.</p>
            )}
          </>
        )}
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            Cancelar
          </Button>
          {!batch ? (
            <Button onClick={preview} loading={busy} disabled={!file}>
              Ver vista previa
            </Button>
          ) : (
            <Button onClick={confirm} loading={busy} disabled={batch.summary.validRows === 0}>
              Confirmar importación
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
