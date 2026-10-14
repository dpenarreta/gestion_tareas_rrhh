"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { formatDateTime, novedadesApi } from "./api";
import { ErrorBox, Label, SelectInput, TextInput } from "./fields";

export type MovementAccess = { entries: boolean; exits: boolean; canManage: boolean };
type Kind = "entries" | "exits";

type EntryRow = {
  id: string;
  kind: "ALTA" | "REINGRESO";
  kindLabel: string;
  registeredAt: string;
  cedula: string;
  fullName: string;
  cargo: string;
  area: string;
  regional: string;
  supervisor: string;
  status: string;
  statusLabel: string;
  registeredBy: string;
  origin: string;
};
type ExitRow = {
  id: number;
  changedAt: string;
  previousStatusLabel: string;
  cedula: string;
  fullName: string;
  cargo: string;
  area: string;
  regional: string;
  supervisor: string;
  status: string;
  statusLabel: string;
  changedBy: string;
};
type Page<T> = {
  results: T[];
  count: number;
  page: number;
  pageSize: number;
  counters: { movements: number; people: number; altas?: number; reingresos?: number };
};
type Options = {
  supervisors: { id: number; name: string }[];
  cargos: string[];
  statuses: { value: string; label: string }[];
};
type Filters = {
  q: string;
  dateFrom: string;
  dateTo: string;
  cargo: string;
  supervisor: string;
  status: string;
  order: "desc" | "asc";
};

const EMPTY_FILTERS: Filters = { q: "", dateFrom: "", dateTo: "", cargo: "", supervisor: "", status: "", order: "desc" };
const TAB_LABEL: Record<Kind, string> = { entries: "Ingresos", exits: "Salidas" };
const STATUS_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "warning",
};

// Consulta consolidada de Ingresos y Salidas (solo lectura). Los datos salen
// de los registros que ya existen en NEXO (altas, reingresos y cambios a
// Inactivo); filtrar, paginar o exportar nunca crea movimientos ni dispara
// la notificación de salida.
export default function MovementsView({ access }: { access: MovementAccess }) {
  const tabs = (["entries", "exits"] as Kind[]).filter((k) => access[k]);
  const [tab, setTab] = useState<Kind>(tabs[0]);
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    novedadesApi.get<Options>("movements/options").then((r) => {
      if (r.ok) setOptions(r.data);
    });
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-title">Ingresos y Salidas</h1>
        <p className="text-sm text-secondary">
          Consulta consolidada de los movimientos registrados en Control Operativo de Novedades.
        </p>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-border">
        {tabs.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
              tab === k ? "border-primary text-primary" : "border-transparent text-secondary hover:text-title"
            }`}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>
      <MovementTab key={tab} kind={tab} options={options} />
    </div>
  );
}

function MovementTab({ kind, options }: { kind: Kind; options: Options | null }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<EntryRow | ExitRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // La búsqueda por texto espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(
    () => ({
      q: filters.q,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      cargo: filters.cargo,
      supervisor: filters.supervisor,
      status: filters.status,
      order: filters.order,
    }),
    [filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const result = await novedadesApi.get<Page<EntryRow | ExitRow>>(`movements/${kind}`, {
      ...query,
      page,
      page_size: pageSize,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setData(result.data);
  }, [kind, query, page, pageSize]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  function update(changes: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...changes }));
    setPage(1);
  }

  async function exportXlsx() {
    setExporting(true);
    const message = await novedadesApi.download(`movements/${kind}/export`, query, `${kind === "entries" ? "ingresos" : "salidas"}.xlsx`);
    setExporting(false);
    if (message) setError(message);
  }

  const supervisorName = options?.supervisors.find((s) => String(s.id) === filters.supervisor)?.name;
  const statusName = options?.statuses.find((s) => s.value === filters.status)?.label;
  const active = [
    filters.q && `Búsqueda: “${filters.q}”`,
    filters.dateFrom && `Desde ${formatDay(filters.dateFrom)}`,
    filters.dateTo && `Hasta ${formatDay(filters.dateTo)}`,
    filters.cargo && `Cargo: ${filters.cargo}`,
    filters.supervisor && `Supervisor: ${supervisorName ?? filters.supervisor}`,
    filters.status && `Estado actual: ${statusName ?? filters.status}`,
  ].filter(Boolean) as string[];
  const totalPages = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;
  const isEntries = kind === "entries";

  return (
    <div className="space-y-4">
      <p className="text-xs text-secondary">
        {isEntries
          ? "Ingresos = altas de colaboradores en la base de NEXO (formulario o importación) y reingresos (cambio de Inactivo a Activo). La fecha es la del REGISTRO en NEXO, no una fecha formal de ingreso laboral."
          : "Salidas = cambios de estado a Inactivo registrados en NEXO. Es un evento operativo: la fecha es la del cambio en el sistema y no acredita por sí misma una desvinculación laboral formal."}
      </p>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Counter label={isEntries ? "Ingresos (movimientos)" : "Salidas (movimientos)"} value={data.counters.movements} />
          <Counter label="Personas distintas" value={data.counters.people} />
          {isEntries && <Counter label="Altas en NEXO" value={data.counters.altas ?? 0} />}
          {isEntries && <Counter label="Reingresos" value={data.counters.reingresos ?? 0} />}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <label className="block">
          <Label>Buscar</Label>
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cédula o nombre" aria-label="Buscar por cédula o nombre" />
        </label>
        <label className="block">
          <Label>Desde</Label>
          <TextInput type="date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} aria-label="Fecha desde" />
        </label>
        <label className="block">
          <Label>Hasta</Label>
          <TextInput type="date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })} aria-label="Fecha hasta" />
        </label>
        <label className="block">
          <Label>Orden</Label>
          <SelectInput value={filters.order} onChange={(e) => update({ order: e.target.value as Filters["order"] })} aria-label="Orden por fecha">
            <option value="desc">Más recientes primero</option>
            <option value="asc">Más antiguos primero</option>
          </SelectInput>
        </label>
        <label className="block">
          <Label>Cargo</Label>
          <SelectInput value={filters.cargo} onChange={(e) => update({ cargo: e.target.value })} aria-label="Filtrar por cargo">
            <option value="">Todos</option>
            {options?.cargos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="block">
          <Label>Supervisor</Label>
          <SelectInput value={filters.supervisor} onChange={(e) => update({ supervisor: e.target.value })} aria-label="Filtrar por supervisor">
            <option value="">Todos</option>
            {options?.supervisors.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="block">
          <Label>Estado actual</Label>
          <SelectInput value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label="Filtrar por estado actual">
            <option value="">Todos</option>
            {options?.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectInput>
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportXlsx} loading={exporting} disabled={!data || data.count === 0}>
            Exportar a Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
        <span>{data ? `${data.count} resultado(s)` : "Cargando…"}</span>
        {active.map((a) => (
          <Badge key={a} variant="info">
            {a}
          </Badge>
        ))}
        {active.length > 0 && (
          <button
            className="underline hover:text-title"
            onClick={() => {
              setSearch("");
              setFilters({ ...EMPTY_FILTERS, order: filters.order });
              setPage(1);
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <ErrorBox message={error} />

      {loading && !data ? (
        <div className="flex justify-center py-10">
          <Spinner className="text-primary" />
        </div>
      ) : data && data.results.length === 0 ? (
        <p className="text-sm text-secondary py-8 text-center border border-dashed border-border rounded-xl">
          {active.length
            ? "No hay registros que coincidan con los filtros aplicados."
            : isEntries
              ? "Todavía no hay ingresos registrados."
              : "Todavía no hay salidas registradas."}
        </p>
      ) : data ? (
        <div className={`overflow-x-auto border border-border rounded-xl bg-surface ${loading ? "opacity-60" : ""}`}>
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-secondary">
              <tr>
                {(isEntries
                  ? ["Fecha de registro en NEXO", "Tipo", "Cédula", "Empleado", "Cargo", "Área", "Supervisor responsable", "Estado actual", "Registrado por", "Origen"]
                  : ["Fecha de cambio a Inactivo", "Estado anterior", "Cédula", "Empleado", "Cargo", "Área", "Supervisor responsable", "Estado actual", "Cambiado por"]
                ).map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isEntries
                ? (data.results as EntryRow[]).map((r) => (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.registeredAt)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={r.kind === "REINGRESO" ? "info" : "neutral"}>{r.kindLabel}</Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">{r.cedula}</td>
                      <td className="px-3 py-2 text-title">{r.fullName}</td>
                      <td className="px-3 py-2">{r.cargo || "—"}</td>
                      <td className="px-3 py-2">{r.area || "—"}</td>
                      <td className="px-3 py-2">{r.supervisor || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{r.statusLabel}</Badge>
                      </td>
                      <td className="px-3 py-2">{r.registeredBy || "—"}</td>
                      <td className="px-3 py-2 text-secondary">{r.origin}</td>
                    </tr>
                  ))
                : (data.results as ExitRow[]).map((r) => (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.changedAt)}</td>
                      <td className="px-3 py-2">{r.previousStatusLabel}</td>
                      <td className="px-3 py-2 font-mono">{r.cedula}</td>
                      <td className="px-3 py-2 text-title">{r.fullName}</td>
                      <td className="px-3 py-2">{r.cargo || "—"}</td>
                      <td className="px-3 py-2">{r.area || "—"}</td>
                      <td className="px-3 py-2">{r.supervisor || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{r.statusLabel}</Badge>
                      </td>
                      <td className="px-3 py-2">{r.changedBy || "—"}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
          <span>
            Página {data.page} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <SelectInput
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Registros por página"
              className="w-auto"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </SelectInput>
            <Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-2xl font-bold text-title">{value}</div>
      <div className="text-xs text-secondary">{label}</div>
    </div>
  );
}

function formatDay(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
