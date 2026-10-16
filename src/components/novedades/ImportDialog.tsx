"use client";

import { useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox, Label, SelectInput } from "./fields";
import type { ImportBatch } from "./types";

type Kind = "WORKED_DAYS" | "OVERTIME" | "COLLABORATORS";

type Props = {
  kind: Kind;
  /** Período de las novedades; la base de colaboradores no depende de uno. */
  period?: string;
  /** Equipo destino de la base importada (el Administrador debe elegirlo). */
  supervisorId?: number | null;
  supervisorName?: string;
  /** Rango real del período (Días laborados): se muestra en las instrucciones. */
  periodRange?: { startDate: string; endDate: string; label: string };
  onClose: () => void;
  onImported: () => void;
};

const TITLE: Record<Kind, string> = {
  WORKED_DAYS: "Importar Días laborados",
  OVERTIME: "Importar Horas extras",
  COLLABORATORS: "Importar Base de colaboradores",
};

const TEMPLATE_HINT: Record<Kind, string> = {
  WORKED_DAYS: "Supervisor | Cargo | Cédula | Empleado | una columna por fecha del período",
  OVERTIME:
    "FECHA | CEDULA | NOMBRE DEL COLABORADOR | REGIONAL | ÁREA | CARGO | # HORAS EXTRAS | # HORAS SABADO | SABADO | DOMINGO | FERIADO | TRABAJO REALIZADO | OBSERVACIONES",
  COLLABORATORS:
    "CEDULA | NOMBRES COMPLETOS | REGIONAL | ÁREA | CARGO | NUEVO INGRESO (X si es un nuevo ingreso, vacía si no; también se reconocen «Cédula», «Empleado», «Nombre del colaborador»; otras columnas se ignoran)",
};

const ROW_STATUS: Record<string, { text: string; variant: "info" | "warning" | "neutral" }> = {
  NEW: { text: "Nuevo", variant: "info" },
  EXISTING: { text: "Existente · se actualizaría", variant: "warning" },
  UNCHANGED: { text: "Existente · sin cambios", variant: "neutral" },
};
const FIELD_LABEL: Record<string, string> = { fullName: "Nombre", regional: "Regional", area: "Área", cargo: "Cargo" };

const fmt = (iso: string) => iso.split("-").reverse().join("/");

export default function ImportDialog({ kind, period, supervisorId, supervisorName, periodRange, onClose, onImported }: Props) {
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [strategy, setStrategy] = useState<"skip" | "update">("skip");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isBase = kind === "COLLABORATORS";

  async function preview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    if (period) form.set("period", period);
    if (isBase && supervisorId) form.set("supervisor_id", String(supervisorId));
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
    const s = result.data.summary;
    showToast(
      isBase
        ? `Base importada: ${s.created ?? 0} creados, ${s.updated ?? 0} actualizados, ${s.skipped ?? 0} sin cambios` +
            (s.rejected ? `, ${s.rejected} rechazados (vea el reporte).` : ".")
        : `Importación aplicada: ${s.applied ?? 0} aplicados, ${s.skipped ?? 0} omitidos.`,
      s.rejected ? "warning" : "success",
    );
    onImported();
  }

  async function cancel() {
    if (batch && batch.status === "PREVIEW") await novedadesApi.post(`imports/${batch.id}/cancel`);
    onClose();
  }

  const cards: [string, number | undefined, string][] = batch
    ? isBase
      ? [
          ["Filas procesadas", batch.summary.totalRows, "text-title"],
          ["Nuevos", batch.summary.newItems, "text-primary"],
          ["Existentes", batch.summary.existingItems, "text-title"],
          ["Se actualizarían", batch.summary.toUpdate, "text-warning"],
          ["Nuevos ingresos (X)", batch.summary.newHires, "text-primary"],
          ["Duplicados en el archivo", batch.summary.duplicatesInFile, "text-danger"],
          ["Filas inválidas", batch.summary.invalidRows, "text-danger"],
        ]
      : [
          ["Filas válidas", batch.summary.validRows, "text-success"],
          ["Filas con error", batch.summary.invalidRows, "text-danger"],
          ["Nuevos", batch.summary.newItems, "text-title"],
          ["Ya existentes", batch.summary.existingItems, "text-warning"],
        ]
    : [];

  return (
    <Modal open onClose={cancel} size="lg">
      <ModalHeader title={TITLE[kind]} onClose={cancel} />
      <div className="p-5 space-y-4">
        {!batch ? (
          <>
            {isBase ? (
              <p className="text-sm text-secondary">
                Carga inicial o actualización de la base del equipo
                {supervisorName ? (
                  <>
                    {" "}
                    de <strong>{supervisorName}</strong>
                  </>
                ) : null}
                . Las cédulas que no existan se crean; las que ya estén en esta base se informan como existentes. El
                archivo (.xlsx) debe tener:
              </p>
            ) : (
              <p className="text-sm text-secondary">
                Período <strong>{periodRange?.label ?? period}</strong>. El archivo (.xlsx) debe tener los encabezados:
              </p>
            )}
            {kind === "WORKED_DAYS" && periodRange ? (
              <div className="text-xs bg-surface2 rounded-lg p-3 space-y-1.5">
                <p className="font-mono break-words">
                  Supervisor | Cargo | Cédula | Empleado | {fmt(periodRange.startDate)} | … | {fmt(periodRange.endDate)}
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-secondary">
                  <li>Una columna por cada día del período, con la fecha en el encabezado (dd/mm/aaaa).</li>
                  <li>En cada celda, las <strong>horas laboradas</strong> de ese día: 0 a 24, hasta 2 decimales (8 o 7.5).</li>
                  <li>Vacío = no reportado; 0 = cero horas. Sábados y domingos deben quedar vacíos.</li>
                  <li>La persona se identifica por la Cédula; Empleado debe corresponder a esa cédula.</li>
                </ul>
                {supervisorId ? (
                  <button
                    type="button"
                    className="text-primary hover:underline font-semibold"
                    onClick={() =>
                      novedadesApi.download(
                        "worked-days/template",
                        { period, supervisor: supervisorId },
                        `plantilla-dias-laborados-${period}.xlsx`,
                      )
                    }
                  >
                    Descargar la plantilla de este período (con su equipo y las fechas exactas)
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs font-mono bg-surface2 rounded-lg p-2 break-words">{TEMPLATE_HINT[kind]}</p>
            )}
            <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
            <p className="text-xs text-secondary">Primero se muestra una vista previa: no se guarda nada hasta que confirme.</p>
          </>
        ) : (
          <>
            <div className={`grid grid-cols-2 ${isBase ? "sm:grid-cols-3" : "sm:grid-cols-4"} gap-2 text-center text-sm`}>
              {cards.map(([label, value, color]) => (
                <div key={label} className="bg-surface2 rounded-lg p-2">
                  <div className={`text-lg font-bold ${color}`}>{value ?? 0}</div>
                  <div className="text-xs text-secondary">{label}</div>
                </div>
              ))}
            </div>
            {isBase && batch.summary.ignoredColumns && batch.summary.ignoredColumns.length > 0 && (
              <p className="text-xs text-secondary">Columnas ignoradas: {batch.summary.ignoredColumns.join(", ")}</p>
            )}
            {batch.summary.warnings && batch.summary.warnings.length > 0 && (
              <div className="text-xs border border-warning/40 bg-warning/[.06] rounded-lg p-2 space-y-0.5">
                <p className="font-semibold text-warning">Avisos (no impiden importar)</p>
                {batch.summary.warnings.slice(0, 50).map((w, i) => (
                  <p key={i}>
                    {w.row > 1 ? `Fila ${w.row} · ` : ""}
                    {w.column ? `${w.column}: ` : ""}
                    {w.message}
                  </p>
                ))}
              </div>
            )}
            {batch.summary.alreadyImported && (
              <p className="text-sm text-warning">
                Este mismo archivo ya se importó en este período. Si continúa, no se duplicarán registros.
              </p>
            )}
            {isBase && batch.rows.length > 0 && (
              <div className="max-h-56 overflow-y-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface2">
                    <tr>
                      {["Fila", "Cédula", "Nombre", "Resultado", "Cambios"].map((h) => (
                        <th key={h} className="text-left px-2 py-1.5 font-semibold text-secondary">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(batch.rows as BaseRow[]).slice(0, 500).map((r) => (
                      <tr key={r.row} className="border-t border-border">
                        <td className="px-2 py-1">{r.row}</td>
                        <td className="px-2 py-1 font-mono">{r.cedula}</td>
                        <td className="px-2 py-1">{r.fullName}</td>
                        <td className="px-2 py-1">
                          <Badge variant={ROW_STATUS[r.status]?.variant ?? "neutral"}>{ROW_STATUS[r.status]?.text ?? r.status}</Badge>
                        </td>
                        <td className="px-2 py-1 text-secondary">
                          {Object.entries(r.changes ?? {})
                            .map(([f, [oldV, newV]]) => `${FIELD_LABEL[f] ?? f}: ${oldV || "—"} → ${newV}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {batch.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-danger">Filas con error ({batch.errors.length}) — no se guardarán</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => novedadesApi.download(`imports/${batch.id}/errors`, {}, `errores-importacion-${batch.id}.xlsx`)}
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
            {(isBase ? (batch.summary.toUpdate ?? 0) > 0 : batch.summary.existingItems > 0) && (
              <label className="block max-w-md">
                <Label>{isBase ? "Colaboradores existentes" : "Registros que ya existen"}</Label>
                <SelectInput value={strategy} onChange={(e) => setStrategy(e.target.value as "skip" | "update")}>
                  {isBase ? (
                    <>
                      <option value="skip">Solo crear los nuevos (no modificar existentes)</option>
                      <option value="update">Crear nuevos y actualizar nombre, regional, área y cargo de existentes</option>
                    </>
                  ) : (
                    <>
                      <option value="skip">Omitirlos (no modificar lo existente)</option>
                      <option value="update">Actualizarlos con el valor del archivo</option>
                    </>
                  )}
                </SelectInput>
                {isBase && (
                  <span className="block text-xs text-secondary mt-1">
                    Nunca se modifican por importación: cédula, estado operativo, supervisor asignado ni usuarios o permisos.
                  </span>
                )}
              </label>
            )}
            {batch.summary.validRows === 0 && <p className="text-sm text-secondary">No hay filas válidas para importar.</p>}
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

type BaseRow = {
  row: number;
  cedula: string;
  fullName: string;
  status: string;
  changes?: Record<string, [string, string]>;
};
