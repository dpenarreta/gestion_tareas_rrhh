"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, novedadesApi } from "./api";
import { ErrorBox, Label, TextInput } from "./fields";
import { PERM, type OvertimeIndicators, type OvertimeRecord } from "./types";
import type { ModuleContext } from "./NovedadesModule";
import OvertimeFormDialog from "./OvertimeFormDialog";
import CorrectionDialog from "./CorrectionDialog";
import OvertimeCapture from "./OvertimeCapture";
import OvertimeDeleteDialog from "./OvertimeDeleteDialog";
import OvertimeMonthBanner from "./OvertimeMonthBanner";
import { SelectInput } from "./fields";

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

type Filters = {
  date_from: string;
  date_to: string;
  cedula: string;
  name: string;
  regional: string;
  area: string;
  cargo: string;
  jornada: string;
};
const EMPTY_FILTERS: Filters = { date_from: "", date_to: "", cedula: "", name: "", regional: "", area: "", cargo: "", jornada: "" };
const PAGE = 200;

type Indicators = OvertimeIndicators & {
  collaboratorsWithRecords?: number;
  supervisorsClosed?: number;
  supervisorsPending?: number;
};

// Horas extras: la captura masiva (tabla editable tipo Excel) es la vía
// principal de registro; la consulta muestra el consolidado del ámbito del
// usuario (nacional para el Asistente/Administrador).
export default function OvertimeView({ ctx }: { ctx: ModuleContext }) {
  // El Asistente también captura y corrige fechas pasadas (decisión del 2026-10-13).
  const canCapture = ctx.can(PERM.registrar);
  const [mode, setMode] = useState<"CAPTURA" | "CONSULTA">(canCapture ? "CAPTURA" : "CONSULTA");
  const month = ctx.overtimeMonths.find((m) => m.code === ctx.overtimeMonth);
  return (
    <div className="space-y-3">
      {month && (
        <OvertimeMonthBanner
          key={`${month.code}-${month.status}-${month.remainingSeconds}`}
          ctx={ctx}
          month={month}
          supervisorId={ctx.supervisorId}
        />
      )}
      {canCapture && (
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-surface2 text-sm">
          {(["CAPTURA", "CONSULTA"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md ${mode === m ? "bg-surface text-primary font-semibold shadow-sm" : "text-secondary"}`}
            >
              {m === "CAPTURA" ? "Captura masiva" : "Consulta de registros"}
            </button>
          ))}
        </div>
      )}
      {mode === "CAPTURA" && canCapture ? (
        // Con "Todos los supervisores" la captura trabaja con los colaboradores
        // de todos los equipos autorizados; cada fila se guarda en el equipo de
        // su colaborador (lo resuelve el servidor, no el navegador).
        month ? (
          <OvertimeCapture
            key={`${month.code}-${ctx.supervisorId ?? "todos"}`}
            ctx={ctx}
            supervisorId={ctx.supervisorId}
            month={month}
          />
        ) : (
          <p className="text-sm text-secondary py-6">Cargando mes…</p>
        )
      ) : (
        <OvertimeConsult ctx={ctx} />
      )}
    </div>
  );
}

function OvertimeConsult({ ctx }: { ctx: ModuleContext }) {
  const { showToast } = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [records, setRecords] = useState<OvertimeRecord[] | null>(null);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OvertimeRecord | null>(null);
  const [form, setForm] = useState<{ record: OvertimeRecord | null } | null>(null);
  const [deleting, setDeleting] = useState<OvertimeRecord | null>(null);
  const [correcting, setCorrecting] = useState<OvertimeRecord | null>(null);

  const canWrite = ctx.can(PERM.registrar);
  // Horas extras se consulta por MES CALENDARIO (no por el corte 23 → 22).
  const query = { period: ctx.overtimeMonth, supervisor: ctx.supervisorId ?? undefined, ...applied };

  const load = useCallback(async () => {
    setError(null);
    const result = await novedadesApi.get<{ indicators: Indicators; count: number; records: OvertimeRecord[] }>("overtime", {
      period: ctx.overtimeMonth,
      supervisor: ctx.supervisorId ?? undefined,
      ...applied,
      offset,
      limit: PAGE,
    });
    if (result.ok) {
      setRecords(result.data.records);
      setIndicators(result.data.indicators);
      setCount(result.data.count);
    } else {
      setRecords([]);
      setError(result.error);
    }
  }, [ctx.overtimeMonth, ctx.supervisorId, applied, offset]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const flag = (v: boolean) => (v ? "SI" : "NO");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          ["Registros", indicators?.records],
          ["Total # horas extras", indicators?.overtimeHours],
          ["Total # horas sábado", indicators?.saturdayHours],
          ["Colaboradores con novedades", indicators?.collaboratorsWithRecords],
          ["Supervisores que reportaron", indicators?.supervisorsReporting],
          ...(indicators?.supervisorsClosed !== undefined
            ? [
                ["Supervisores con el mes cerrado", indicators.supervisorsClosed],
                ["Supervisores sin cerrar el mes", indicators.supervisorsPending],
              ]
            : []),
        ].map(([label, value]) => (
          <div key={label as string} className="bg-surface border border-border rounded-xl p-3">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-bold text-title">{value ?? "—"}</div>
          </div>
        ))}
      </div>

      <form
        className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-9 gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setApplied(filters);
        }}
      >
        <label>
          <Label>Desde</Label>
          <TextInput type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </label>
        <label>
          <Label>Hasta</Label>
          <TextInput type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </label>
        <label>
          <Label>Jornada</Label>
          <SelectInput value={filters.jornada} onChange={(e) => setFilters({ ...filters, jornada: e.target.value })}>
            <option value="">Todas</option>
            <option value="sabado">Sábado</option>
            <option value="domingo">Domingo</option>
            <option value="feriado">Feriado</option>
          </SelectInput>
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
              setOffset(0);
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
              const err = await novedadesApi.download("overtime/export", query, `horas-extras-${ctx.overtimeMonth}.xlsx`);
              if (err) showToast(err, "error");
            }}
          >
            <Download className="w-4 h-4" /> Exportar Excel
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

      {count > PAGE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-secondary">
            {offset + 1}–{Math.min(offset + PAGE, count)} de {count} (los totales y la exportación incluyen todo)
          </span>
          <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE, 0))}>
            Anterior
          </Button>
          <Button variant="secondary" size="sm" disabled={offset + PAGE >= count} onClick={() => setOffset(offset + PAGE)}>
            Siguiente
          </Button>
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
                  Corrección (mes cerrado)
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
        <OvertimeDeleteDialog
          record={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
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

