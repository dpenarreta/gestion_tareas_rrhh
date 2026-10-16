"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "./api";
import { ErrorBox, Label, SelectInput, TextArea, TextInput } from "./fields";
import type { Collaborator, OvertimeRecord } from "./types";
import type { ModuleContext } from "./NovedadesModule";

type Props = { ctx: ModuleContext; record: OvertimeRecord | null; onClose: () => void; onSaved: () => void };

function weekday(iso: string) {
  return iso ? new Date(`${iso}T12:00:00`).getDay() : -1;
}

export default function OvertimeFormDialog({ ctx, record, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [collaboratorId, setCollaboratorId] = useState<number | "">(record?.collaboratorId ?? "");
  const [date, setDate] = useState(record?.date ?? "");
  const [overtimeHours, setOvertimeHours] = useState(record?.overtimeHours ?? "");
  const [saturdayHours, setSaturdayHours] = useState(record?.saturdayHours ?? "");
  const [isSaturday, setIsSaturday] = useState(record?.isSaturday ?? false);
  const [isSunday, setIsSunday] = useState(record?.isSunday ?? false);
  const [isHoliday, setIsHoliday] = useState(record?.isHoliday ?? false);
  const [workDone, setWorkDone] = useState(record?.workDone ?? "");
  const [observations, setObservations] = useState(record?.observations ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (record) return;
    novedadesApi
      .get<Collaborator[]>("collaborators", { status: "ACTIVE", supervisor: ctx.supervisorId ?? undefined })
      .then((r) => r.ok && setCollaborators(r.data));
  }, [record, ctx.supervisorId]);

  const selected = useMemo(
    () => collaborators.find((c) => c.id === collaboratorId) ?? null,
    [collaborators, collaboratorId],
  );

  function onDateChange(value: string) {
    setDate(value);
    // Sugerencia según el día; el supervisor puede ajustarla.
    setIsSaturday(weekday(value) === 6);
    setIsSunday(weekday(value) === 0);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const values = { overtimeHours, saturdayHours, isSaturday, isSunday, isHoliday, workDone, observations };
    const result = record
      ? await novedadesApi.patch(`overtime/${record.id}`, { ...values, version: record.version })
      : await novedadesApi.post("overtime", { ...values, collaboratorId, date });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(record ? "Registro actualizado." : "Novedad registrada.", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={record ? "Editar horas extras" : "Registrar horas extras"} onClose={onClose} />
      <div className="p-5 space-y-4">
        {record ? (
          <p className="text-sm text-secondary">
            {record.fullName} ({record.cedula}) · {record.date.split("-").reverse().join("/")}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <label>
              <Label>Colaborador (de su base)</Label>
              <SelectInput value={collaboratorId} onChange={(e) => setCollaboratorId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Seleccione…</option>
                {collaborators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} — {c.cedula}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label>
              <Label>Fecha</Label>
              <TextInput type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
            </label>
            {selected && (
              <p className="sm:col-span-2 text-xs text-secondary">
                Regional: {selected.regional || "—"} · Área: {selected.area || "—"} · Cargo: {selected.cargo || "—"}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
          <label>
            <Label># Horas extras</Label>
            <TextInput value={overtimeHours} onChange={(e) => setOvertimeHours(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            <Label># Horas sábado</Label>
            <TextInput value={saturdayHours} onChange={(e) => setSaturdayHours(e.target.value)} inputMode="decimal" />
          </label>
          {(
            [
              ["Sábado", isSaturday, setIsSaturday],
              ["Domingo", isSunday, setIsSunday],
              ["Feriado", isHoliday, setIsHoliday],
            ] as [string, boolean, (v: boolean) => void][]
          ).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
            </label>
          ))}
        </div>
        <label className="block">
          <Label>Trabajo realizado</Label>
          <TextArea value={workDone} onChange={(e) => setWorkDone(e.target.value)} maxLength={500} />
        </label>
        <label className="block">
          <Label>Observaciones</Label>
          <TextArea value={observations} onChange={(e) => setObservations(e.target.value)} maxLength={1000} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!record && (!collaboratorId || !date)}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
