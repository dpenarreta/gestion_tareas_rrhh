"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, novedadesApi } from "./api";
import { ErrorBox, Label, TextArea, TextInput } from "./fields";
import { PERM, type OvertimeIndicators, type OvertimeRecord } from "./types";
import type { ModuleContext } from "./NovedadesModule";
import OvertimeFormDialog from "./OvertimeFormDialog";
import ImportDialog from "./ImportDialog";
import CorrectionDialog from "./CorrectionDialog";

// Encabezados EXACTOS de la tabla en pantalla (13). La exportación agrega
// SUPERVISOR después de CARGO (14) — eso lo arma Django.
const HEADERS = [
  "FECHA",
  "CEDULA",
  "NOMBRE DEL COLABORADOR",
  "REGIONAL",
  "ÁREA",
  "CARGO",
  "# HORAS EXTRAS",
  "# HORAS SABADO",
  "SABADO",
  "DOMINGO",
  "FERIADO",
  "TRABAJO REALIZADO",
  "OBSERVACIONES",
];

type Filters = { date: string; cedula: string; name: string; regional: string; area: string; cargo: string };
const EMPTY_FILTERS: Filters = { date: "", cedula: "", name: "", regional: "", area: "", cargo: "" };

export default function OvertimeView({ ctx }: { ctx: ModuleContext }) {
  const { showToast } = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [records, setRecords] = useState<OvertimeRecord[] | null>(null);
  const [indicators, setIndicators] = useState<OvertimeIndicators | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OvertimeRecord | null>(null);
  const [form, setForm] = useState<{ record: OvertimeRecord | null } | null>(null);
  const [deleting, setDeleting] = useState<OvertimeRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [correcting, setCorrecting] = useState<OvertimeRecord | null>(null);

  const canWrite = ctx.can(PERM.registrar) && !ctx.me.isAssistant;
  const query = { period: ctx.period, supervisor: ctx.supervisorId ?? undefined, ...applied };

  const load = useCallback(async () => {
    setError(null);
    const result = await novedadesApi.get<{ indicators: OvertimeIndicators; records: OvertimeRecord[] }>("overtime", {
      period: ctx.period,
      supervisor: ctx.supervisorId ?? undefined,
      ...applied,
    });
    if (result.ok) {
      setRecords(result.data.records);
      setIndicators(result.data.indicators);
    } else {
      setRecords([]);
      setError(result.error);
    }
  }, [ctx.period, ctx.supervisorId, applied]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const flag = (v: boolean) => (v ? "SI" : "NO");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ["Registros", indicators?.records],
          ["Total horas extras", indicators?.overtimeHours],
          ["Total horas sábado", indicators?.saturdayHours],
          ["Supervisores que reportaron", indicators?.supervisorsReporting],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-surface border border-border rounded-xl p-3">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-bold text-title">{value ?? "—"}</div>
          </div>
        ))}
      </div>

      <form
        className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filters);
        }}
      >
        <label>
          <Label>Fecha</Label>
          <TextInput type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
        </label>
        {(
          [
            ["cedula", "Cédula"],
            ["name", "Nombre"],
            ["regional", "Regional"],
            ["area", "Área"],
            ["cargo", "Cargo"],
          ] as [keyof Filters, string][]
        ).map(([key, label]) => (
          <label key={key}>
            <Label>{label}</Label>
            <TextInput value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} />
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
            }}
          >
            Limpiar
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap justify-end gap-2">
        {ctx.can(PERM.exportar) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const err = await novedadesApi.download("overtime/export", query, `horas-extras-${ctx.period}.xlsx`);
              if (err) showToast(err, "error");
            }}
          >
            <Download className="w-4 h-4" /> Exportar Excel
          </Button>
        )}
        {canWrite && ctx.can(PERM.importar) && (
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="w-4 h-4" /> Importar
          </Button>
        )}
        {canWrite && (
          <Button size="sm" onClick={() => setForm({ record: null })}>
            <Plus className="w-4 h-4" /> Registrar novedad
          </Button>
        )}
      </div>

      <ErrorBox message={error} />
      {records === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : (
        <div className="overflow-auto max-h-[60vh] border border-border rounded-xl bg-surface">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                {HEADERS.map((h) => (
                  <th key={h} className="sticky top-0 z-10 bg-surface2 border-b border-border px-2 py-2 text-left font-semibold text-secondary whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="text-center text-secondary py-10">
                    Sin registros para los filtros seleccionados.
                  </td>
                </tr>
              )}
              {records.map((r) => (
                <tr key={r.id} onClick={() => setDetail(r)} className="cursor-pointer hover:bg-primary-surface/40">
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="border-b border-border px-2 py-1.5 font-mono">{r.cedula}</td>
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap">{r.fullName}</td>
                  <td className="border-b border-border px-2 py-1.5">{r.regional}</td>
                  <td className="border-b border-border px-2 py-1.5">{r.area}</td>
                  <td className="border-b border-border px-2 py-1.5">{r.cargo}</td>
                  <td className="border-b border-border px-2 py-1.5 text-right">{r.overtimeHours}</td>
                  <td className="border-b border-border px-2 py-1.5 text-right">{r.saturdayHours}</td>
                  <td className="border-b border-border px-2 py-1.5 text-center">{flag(r.isSaturday)}</td>
                  <td className="border-b border-border px-2 py-1.5 text-center">{flag(r.isSunday)}</td>
                  <td className="border-b border-border px-2 py-1.5 text-center">{flag(r.isHoliday)}</td>
                  <td className="border-b border-border px-2 py-1.5 max-w-[220px] truncate" title={r.workDone}>
                    {r.workDone}
                  </td>
                  <td className="border-b border-border px-2 py-1.5 max-w-[220px] truncate" title={r.observations}>
                    {r.observations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <Modal open onClose={() => setDetail(null)} variant="drawer">
          <ModalHeader title="Detalle del registro" onClose={() => setDetail(null)} />
          <div className="p-5 space-y-3 text-sm">
            <dl className="grid grid-cols-[140px_1fr] gap-y-1.5">
              <dt className="text-secondary">Colaborador</dt>
              <dd>
                {detail.fullName} ({detail.cedula})
              </dd>
              <dt className="text-secondary">Fecha</dt>
              <dd>{formatDate(detail.date)}</dd>
              <dt className="text-secondary">Supervisor</dt>
              <dd className="font-semibold">{detail.supervisorName}</dd>
              <dt className="text-secondary">Período</dt>
              <dd>{detail.period}</dd>
              <dt className="text-secondary">Horas extras / sábado</dt>
              <dd>
                {detail.overtimeHours} / {detail.saturdayHours}
              </dd>
              <dt className="text-secondary">Trabajo realizado</dt>
              <dd className="whitespace-pre-wrap">{detail.workDone || "—"}</dd>
              <dt className="text-secondary">Observaciones</dt>
              <dd className="whitespace-pre-wrap">{detail.observations || "—"}</dd>
              <dt className="text-secondary">Registrado por</dt>
              <dd>
                {detail.createdByName} · {formatDateTime(detail.createdAt)}
              </dd>
              <dt className="text-secondary">Última modificación</dt>
              <dd>
                {detail.updatedByName} · {formatDateTime(detail.updatedAt)}
              </dd>
            </dl>
            <p className="text-xs text-secondary">Registrar una novedad no implica su aprobación para pago.</p>
            <div className="flex flex-wrap gap-2 pt-2">
              {canWrite && (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      setForm({ record: detail });
                      setDetail(null);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setDeleting(detail);
                      setDetail(null);
                    }}
                  >
                    Eliminar
                  </Button>
                </>
              )}
              {ctx.can(PERM.corregir) && ctx.me.nationalWrite && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setCorrecting(detail);
                    setDetail(null);
                  }}
                >
                  Corrección (período cerrado)
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {form && (
        <OvertimeFormDialog
          ctx={ctx}
          record={form.record}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          record={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            load();
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          kind="OVERTIME"
          period={ctx.period}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            load();
          }}
        />
      )}
      {correcting && (
        <CorrectionDialog
          target="OVERTIME"
          title={`${correcting.fullName} · ${formatDate(correcting.date)}`}
          currentValue={correcting.overtimeHours}
          payload={{ recordId: correcting.id }}
          allowDelete
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({ record, onClose, onDone }: { record: OvertimeRecord; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Eliminar registro" onClose={onClose} />
      <div className="p-5 space-y-3">
        <p className="text-sm text-secondary">
          {record.fullName} · {formatDate(record.date)}. El registro se conserva en el historial (eliminación lógica) y
          se notificará al Administrador.
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
          <Button
            variant="destructive"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              const result = await novedadesApi.del(`overtime/${record.id}`, { reason });
              setSaving(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              showToast("Registro eliminado.", "success");
              onDone();
            }}
          >
            Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
