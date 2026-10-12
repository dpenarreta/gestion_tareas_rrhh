"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { Spinner } from "@/components/ui/Skeleton";
import { formatDateTime, novedadesApi } from "./api";
import { ErrorBox, SelectInput, TextInput } from "./fields";
import type { NovedadEvent } from "./types";
import type { ModuleContext } from "./NovedadesModule";

const ACTION_LABEL: Record<string, string> = {
  "collaborator.created": "Alta de colaborador",
  "collaborator.updated": "Modificación de colaborador",
  "collaborator.status_changed": "Cambio de estado",
  "collaborator.reassigned": "Reasignación",
  "collaborator.assignment_conflict": "Intento de registro (asignado a otro)",
  "worked_day.created": "Días laborados (nuevo)",
  "worked_day.updated": "Días laborados (cambio)",
  "overtime.created": "Horas extras (nuevo)",
  "overtime.updated": "Horas extras (cambio)",
  "overtime.deleted": "Horas extras (eliminación)",
  "period.closed": "Cierre de período",
  "import.confirmed": "Importación de Excel",
  "export.overtime": "Exportación de Excel",
  "correction.worked_day": "Corrección (días laborados)",
  "correction.overtime": "Corrección (horas extras)",
  "permission.role_changed": "Permiso de rol",
  "permission.override_created": "Excepción individual",
  "permission.override_revoked": "Excepción revocada",
};

const PAGE = 100;

export default function HistoryView({ ctx, kind }: { ctx: ModuleContext; kind?: "permissions" }) {
  const [events, setEvents] = useState<NovedadEvent[] | null>(null);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [allPeriods, setAllPeriods] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await novedadesApi.get<{ count: number; results: NovedadEvent[] }>("history", {
      period: allPeriods || kind ? undefined : ctx.period,
      supervisor: ctx.supervisorId ?? undefined,
      action,
      q,
      kind,
      date_from: dateFrom,
      date_to: dateTo,
      offset,
      limit: PAGE,
    });
    if (result.ok) {
      setEvents(result.data.results);
      setCount(result.data.count);
      setError(null);
    } else {
      setEvents([]);
      setError(result.error);
    }
  }, [ctx.period, ctx.supervisorId, action, q, kind, offset, allPeriods, dateFrom, dateTo]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-3">
      {!kind && (
        <div className="flex flex-wrap gap-2 items-center">
          <SearchInput value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Buscar colaborador…" className="w-64" />
          <SelectInput value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} className="w-64">
            <option value="">Todas las operaciones</option>
            <option value="collaborator.">Colaboradores</option>
            <option value="worked_day.">Días laborados</option>
            <option value="overtime.">Horas extras</option>
            <option value="period.">Cierres</option>
            <option value="import.">Importaciones</option>
            <option value="correction.">Correcciones</option>
          </SelectInput>
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={allPeriods} onChange={(e) => { setAllPeriods(e.target.checked); setOffset(0); }} />
            Todos los períodos
          </label>
          <label className="flex items-center gap-1 text-sm text-secondary">
            Desde
            <TextInput type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }} className="w-40" />
          </label>
          <label className="flex items-center gap-1 text-sm text-secondary">
            Hasta
            <TextInput type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setOffset(0); }} className="w-40" />
          </label>
        </div>
      )}
      <ErrorBox message={error} />
      {events === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : (
        <div className="overflow-auto max-h-[60vh] border border-border rounded-xl bg-surface">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                {["Fecha y hora", "Operación", "Usuario", "Rol", "Supervisor", "Período", "Registro", "Campo", "Anterior", "Nuevo", "Motivo", "Archivo"].map((h) => (
                  <th key={h} className="sticky top-0 bg-surface2 border-b border-border px-2 py-2 text-left font-semibold text-secondary whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center text-secondary py-10">
                    Sin eventos registrados.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap">{e.actorName}</td>
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap text-secondary">{e.actorRole}</td>
                  <td className="border-b border-border px-2 py-1.5 whitespace-nowrap">{e.supervisorName}</td>
                  <td className="border-b border-border px-2 py-1.5">{e.period ?? ""}</td>
                  <td className="border-b border-border px-2 py-1.5">{e.targetLabel}</td>
                  <td className="border-b border-border px-2 py-1.5">{e.field}</td>
                  <td className="border-b border-border px-2 py-1.5 text-secondary">{e.oldValue}</td>
                  <td className="border-b border-border px-2 py-1.5">{e.newValue}</td>
                  <td className="border-b border-border px-2 py-1.5">{e.reason}</td>
                  <td className="border-b border-border px-2 py-1.5 text-secondary">{e.sourceFile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {count > PAGE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-secondary">
            {offset + 1}–{Math.min(offset + PAGE, count)} de {count}
          </span>
          <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE, 0))}>
            Anterior
          </Button>
          <Button variant="secondary" size="sm" disabled={offset + PAGE >= count} onClick={() => setOffset(offset + PAGE)}>
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
