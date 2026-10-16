"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SYNC_LABEL,
  isRetryable,
  pendingStore,
  retryDelay,
  type SyncState,
} from "@/lib/novedadesAutosave";
import { formatDate, formatDateTime, novedadesApi } from "./api";
import { ErrorBox } from "./fields";
import type { ModuleContext } from "./NovedadesModule";

// Horas Depuradas: copia INDEPENDIENTE del consolidado de Horas extras, por mes
// calendario. El Jefe de Operaciones la ajusta (guardado automático); el
// Administrador la consulta y exporta. Nada de esta pantalla escribe en la
// base de los supervisores ni en el consolidado del Asistente: el servidor lo
// garantiza (DepurationService), la pantalla solo lo refleja.

type DepFields = {
  overtimeHours: string;
  saturdayHours: string;
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  workDone: string;
  observations: string;
};

type DepRow = {
  id: number;
  sourceId: number;
  version: number;
  date: string;
  cedula: string;
  fullName: string;
  supervisorName: string;
  excluded: boolean;
  modified: boolean;
  /** "" = el origen sigue igual a la fotografía; "changed"/"deleted" = cambió después de copiar. */
  sourceState: "" | "changed" | "deleted";
  original: DepFields;
  current: DepFields;
  differenceHours: string;
};

type LocalRow = DepRow & { dirty?: boolean; rev?: number; error?: string };

type DepStatus = {
  period: string;
  label: string;
  exists: boolean;
  canCreate: boolean;
  canEdit: boolean;
  monthEnded: boolean;
  source: { records: number; overtimeHours: string; saturdayHours: string; supervisorsTotal: number; supervisorsClosed: number };
  depuration?: {
    id: number;
    createdAt: string;
    createdBy: string;
    sourceCount: number;
    sourceOvertimeHours: string;
    sourceSaturdayHours: string;
    supervisorsTotal: number;
    supervisorsClosed: number;
    rows: number;
    excluded: number;
    modified: number;
    overtimeHours: string;
    saturdayHours: string;
    lastChangeAt: string | null;
    lastChangeBy: string;
  };
};

type DepChange = {
  id: number;
  label: string;
  field: string;
  originalValue: string;
  oldValue: string;
  newValue: string;
  reason: string;
  actor: string;
  createdAt: string;
};

type SaveResult = { clientKey: string; status: string; errors: Record<string, string>; id?: number; version?: number };

const FIELD_LABEL: Record<string, string> = {
  overtime_hours: "# Horas extras",
  saturday_hours: "# Horas sábado",
  is_saturday: "Sábado",
  is_sunday: "Domingo",
  is_holiday: "Feriado",
  work_done: "Trabajo realizado",
  observations: "Observaciones",
  excluded: "Excluido",
};

const HOURS_RE = /^\d{0,2}([.,]\d{0,2})?$/;

export default function DepurationView({ ctx }: { ctx: ModuleContext }) {
  const { showToast } = useToast();
  const period = ctx.overtimeMonth;
  const [status, setStatus] = useState<DepStatus | null>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [historyFor, setHistoryFor] = useState<LocalRow | "all" | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const store = useMemo(() => pendingStore<LocalRow[]>(`depuradas|${period}|${ctx.me.user.id}`), [period, ctx.me.user.id]);
  const rowsRef = useRef<LocalRow[]>([]);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const flushRef = useRef<() => void>(() => {});
  const canEdit = Boolean(status?.canEdit && status.exists);

  const load = useCallback(async () => {
    setError(null);
    const s = await novedadesApi.get<DepStatus>("depuration", { period });
    if (!mounted.current) return;
    if (!s.ok) {
      setError(s.error);
      return;
    }
    setStatus(s.data);
    if (!s.data.exists) {
      setRows([]);
      return;
    }
    const r = await novedadesApi.get<DepRow[]>("depuration/rows", { period });
    if (!mounted.current) return;
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // Cambios que quedaron sin confirmar en este equipo: se reaplican sobre
    // lo que devolvió el servidor y se reenvían solos.
    const pending = new Map((store.load() ?? []).map((p) => [p.id, p]));
    setRows(
      r.data.map((row) => {
        const local = pending.get(row.id);
        return local ? { ...row, current: local.current, excluded: local.excluded, dirty: true, rev: 1 } : row;
      }),
    );
    if (pending.size) {
      setSync("pending");
      schedule(300);
    }
    // `schedule` solo usa refs.
     
  }, [period, store]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(load);
    const onOnline = () => schedule(0);
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
    };
     
  }, [load]);

  useEffect(() => {
    rowsRef.current = rows;
    flushRef.current = flush;
    if (!status?.exists) return;
    const pending = rows.filter((r) => r.dirty);
    if (pending.length) store.save(pending);
    else store.clear();
  });

  const pendingCount = rows.filter((r) => r.dirty).length;
  const { setDirty } = ctx;
  useEffect(() => {
    setDirty(pendingCount > 0);
    if (!pendingCount) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount, setDirty]);

  function schedule(delay: number) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), delay);
  }

  function edit(id: number, patch: Partial<DepFields> | { excluded: boolean }) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = "excluded" in patch ? { ...r, excluded: patch.excluded } : { ...r, current: { ...r.current, ...patch } };
        return { ...next, dirty: true, rev: (r.rev ?? 0) + 1, error: undefined };
      }),
    );
    schedule(AUTOSAVE_DEBOUNCE_MS);
  }

  async function flush() {
    if (!mounted.current || !canEdit) return;
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    const toSend = rowsRef.current.filter((r) => r.dirty && !r.error);
    if (!toSend.length) return;
    inFlight.current = true;
    setSync("saving");
    const sentRev = new Map(toSend.map((r) => [r.id, r.rev ?? 0]));
    const result = await novedadesApi.post<{ rows: SaveResult[] }>("depuration/rows/save", {
      period,
      rows: toSend.map((r) => ({
        clientKey: String(r.id),
        id: r.id,
        version: r.version,
        ...r.current,
        overtimeHours: r.current.overtimeHours.replace(",", "."),
        saturdayHours: r.current.saturdayHours.replace(",", "."),
        excluded: r.excluded,
      })),
    });
    inFlight.current = false;
    if (!mounted.current) return;
    if (!result.ok) {
      if (isRetryable(result.status)) {
        setSync("pending");
        setSyncMessage(`${result.error} Los cambios se conservan y se reintentará automáticamente.`);
        schedule(retryDelay(attempt.current++));
      } else {
        setSync("error");
        setSyncMessage(result.error);
      }
      return;
    }
    attempt.current = 0;
    const byKey = new Map(result.data.rows.map((r) => [r.clientKey, r]));
    let rejected = 0;
    setRows((prev) =>
      prev.map((r) => {
        const res = byKey.get(String(r.id));
        if (!res) return r;
        const current = (r.rev ?? 0) === sentRev.get(r.id);
        if (res.status === "updated" || res.status === "unchanged") {
          const saved = { ...r, version: res.version ?? r.version };
          // Una edición hecha mientras se guardaba queda pendiente (no se pisa).
          return current ? { ...saved, dirty: false, modified: isModified(saved) } : saved;
        }
        rejected++;
        return current ? { ...r, error: Object.values(res.errors).join(" · ") || "No se pudo guardar." } : r;
      }),
    );
    if (rejected) {
      setSync("error");
      setSyncMessage(`${rejected} fila(s) no se guardaron: revise las marcadas.`);
    } else {
      setSync("saved");
      setSyncMessage(null);
    }
    if (rerun.current) {
      rerun.current = false;
      schedule(50);
    }
  }

  async function createBase() {
    if (!status) return;
    const pendingClose = status.source.supervisorsTotal - status.source.supervisorsClosed;
    const warning = pendingClose
      ? `\n\nAtención: ${pendingClose} de ${status.source.supervisorsTotal} supervisores todavía no cerraron ${status.label}. Lo que registren después NO entrará en esta copia (no hay sincronización automática).`
      : "";
    if (!window.confirm(`Se creará la base de Horas depuradas de ${status.label} con ${status.source.records} registro(s) del consolidado.${warning}\n\n¿Continuar?`)) return;
    setCreating(true);
    const result = await novedadesApi.post<DepStatus & { created: boolean }>("depuration/create", { period, confirm: true });
    setCreating(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    showToast(result.data.created ? "Base de depuración creada." : "La base ya existía: se abrió la misma.", "success");
    load();
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.fullName.toLowerCase().includes(q) || r.cedula.includes(q)) : rows;
  }, [rows, search]);

  if (error) return <ErrorBox message={error} />;
  if (!status)
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-primary" />
      </div>
    );

  const dep = status.depuration;
  return (
    <div className="space-y-3">
      <div className="border border-border rounded-xl bg-surface px-4 py-3 text-sm space-y-1" role="status">
        <p className="font-semibold text-title">
          Horas Depuradas · {status.label}{" "}
          <span className="text-xs font-normal text-secondary">(copia independiente: no modifica lo reportado por los supervisores ni el consolidado)</span>
        </p>
        {dep ? (
          <p className="text-secondary">
            Creada el {formatDateTime(dep.createdAt)} por {dep.createdBy} con {dep.sourceCount} registro(s) del consolidado (
            {dep.supervisorsClosed}/{dep.supervisorsTotal} supervisores habían cerrado). Horas originales: {dep.sourceOvertimeHours} h
            extra / {dep.sourceSaturdayHours} h sábado · Depuradas: <strong>{dep.overtimeHours}</strong> h extra /{" "}
            <strong>{dep.saturdayHours}</strong> h sábado · {dep.modified} registro(s) ajustados · {dep.excluded} excluido(s)
            {dep.lastChangeAt ? ` · Último cambio: ${formatDateTime(dep.lastChangeAt)} por ${dep.lastChangeBy}` : ""}.
          </p>
        ) : (
          <p className="text-secondary">
            Todavía no existe la base depurable de este mes. Consolidado disponible: {status.source.records} registro(s) (
            {status.source.overtimeHours} h extra / {status.source.saturdayHours} h sábado; {status.source.supervisorsClosed}/
            {status.source.supervisorsTotal} supervisores cerraron).
            {!status.monthEnded && " El mes está en curso: la base se crea cuando termina."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status.canCreate && (
            <Button size="sm" onClick={createBase} loading={creating} disabled={creating}>
              <Plus className="w-4 h-4" /> Crear base de depuración
            </Button>
          )}
          {dep && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  // El servidor arma el archivo con lo YA guardado: primero se envía lo pendiente.
                  if (pendingCount) {
                    showToast("Hay cambios guardándose; exporte cuando el indicador diga «Guardado».", "warning");
                    return;
                  }
                  const err = await novedadesApi.download("depuration/export", { period }, `horas-depuradas-${period}.xlsx`);
                  if (err) showToast(err, "error");
                }}
              >
                <Download className="w-4 h-4" /> Exportar depuradas
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setHistoryFor("all")}>
                <History className="w-4 h-4" /> Historial de cambios
              </Button>
              {!canEdit && <Badge variant="info">Solo consulta</Badge>}
            </>
          )}
          {canEdit && (sync !== "idle" || pendingCount > 0) && (
            <span
              data-sync={sync}
              className={`text-xs ${sync === "error" ? "text-danger font-medium" : sync === "pending" ? "text-warning font-medium" : sync === "saved" ? "text-success" : "text-secondary"}`}
            >
              {sync === "idle" ? `${SYNC_LABEL.pending} (${pendingCount})` : SYNC_LABEL[sync]}
            </span>
          )}
          {syncMessage && <span className="text-xs text-secondary">{syncMessage}</span>}
          {sync === "pending" && (
            <button className="text-xs text-primary hover:underline" onClick={() => schedule(0)}>
              Reintentar ahora
            </button>
          )}
        </div>
      </div>

      {dep && (
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar cédula o nombre…" className="w-64" />
          {visible.length === 0 ? (
            <p className="text-sm text-secondary py-8 text-center">No hay registros para los criterios elegidos.</p>
          ) : (
            <div className="overflow-auto max-h-[62vh] border border-border rounded-xl bg-surface">
              <table className="border-separate border-spacing-0 text-xs min-w-full">
                <thead>
                  <tr>
                    {["Fecha", "Cédula", "Colaborador", "Supervisor", "# Horas extras", "# Horas sábado", "Sáb", "Dom", "Fer", "Trabajo realizado", "Observaciones", "Excluir", "Dif. (h)", "Origen", ""].map((h) => (
                      <th key={h} className="sticky top-0 z-10 bg-surface2 border-b border-r border-border px-2 py-2 text-left font-semibold text-secondary whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const ro = !canEdit;
                    const changed = (f: keyof DepFields) => r.current[f] !== r.original[f];
                    const cell = "border-b border-r border-border px-1 py-1";
                    const hours = (f: "overtimeHours" | "saturdayHours") => (
                      <td className={`${cell} ${changed(f) ? "bg-warning/[.12]" : ""}`} title={`Original: ${r.original[f]}`}>
                        <input
                          aria-label={`${FIELD_LABEL[f === "overtimeHours" ? "overtime_hours" : "saturday_hours"]} ${r.fullName} ${formatDate(r.date)}`}
                          className="w-16 h-7 px-1 text-right bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                          value={r.current[f]}
                          disabled={ro}
                          inputMode="decimal"
                          onChange={(e) => HOURS_RE.test(e.target.value) && edit(r.id, { [f]: e.target.value })}
                          onBlur={() => schedule(150)}
                        />
                        {changed(f) && <span className="block text-[10px] text-secondary text-right">orig. {r.original[f]}</span>}
                      </td>
                    );
                    const flag = (f: "isSaturday" | "isSunday" | "isHoliday") => (
                      <td className={`${cell} text-center ${changed(f) ? "bg-warning/[.12]" : ""}`} title={`Original: ${r.original[f] ? "Sí" : "No"}`}>
                        <input
                          type="checkbox"
                          aria-label={`${f} ${r.fullName} ${formatDate(r.date)}`}
                          checked={r.current[f]}
                          disabled={ro}
                          onChange={(e) => edit(r.id, { [f]: e.target.checked })}
                        />
                      </td>
                    );
                    const text = (f: "workDone" | "observations") => (
                      <td className={`${cell} ${changed(f) ? "bg-warning/[.12]" : ""}`} title={`Original: ${r.original[f]}`}>
                        <input
                          aria-label={`${f} ${r.fullName} ${formatDate(r.date)}`}
                          className="min-w-[160px] w-full h-7 px-1 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                          value={r.current[f]}
                          disabled={ro}
                          onChange={(e) => edit(r.id, { [f]: e.target.value })}
                          onBlur={() => schedule(150)}
                        />
                      </td>
                    );
                    const diff = Number(r.current.overtimeHours.replace(",", ".") || 0) + Number(r.current.saturdayHours.replace(",", ".") || 0) - Number(r.original.overtimeHours) - Number(r.original.saturdayHours);
                    return (
                      <tr key={r.id} data-row={r.id} className={r.excluded ? "opacity-50" : r.error ? "bg-danger/[.06]" : ""} title={r.error}>
                        <td className={`${cell} whitespace-nowrap`}>{formatDate(r.date)}</td>
                        <td className={`${cell} font-mono`}>{r.cedula}</td>
                        <td className={`${cell} whitespace-nowrap`}>{r.fullName}</td>
                        <td className={`${cell} whitespace-nowrap text-secondary`}>{r.supervisorName}</td>
                        {hours("overtimeHours")}
                        {hours("saturdayHours")}
                        {flag("isSaturday")}
                        {flag("isSunday")}
                        {flag("isHoliday")}
                        {text("workDone")}
                        {text("observations")}
                        <td className={`${cell} text-center`}>
                          <input
                            type="checkbox"
                            aria-label={`Excluir ${r.fullName} ${formatDate(r.date)}`}
                            checked={r.excluded}
                            disabled={ro}
                            onChange={(e) => edit(r.id, { excluded: e.target.checked })}
                          />
                        </td>
                        <td className={`${cell} text-right ${diff ? "font-semibold" : "text-secondary"}`}>
                          {diff > 0 ? "+" : ""}
                          {Math.round(diff * 100) / 100}
                        </td>
                        <td className={cell}>
                          {r.sourceState === "changed" && <Badge variant="warning">Cambió después de copiar</Badge>}
                          {r.sourceState === "deleted" && <Badge variant="neutral">Eliminado en el origen</Badge>}
                        </td>
                        <td className={cell}>
                          <button className="text-primary hover:underline" onClick={() => setHistoryFor(r)}>
                            Historial
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-secondary">
            Las celdas resaltadas difieren del valor original copiado (que se conserva). «Excluir» quita el registro de la base depurada
            sin borrar el original. «Cambió después de copiar» avisa que el consolidado se modificó luego de crear esta copia: no se
            aplica solo.
          </p>
        </>
      )}

      {historyFor && <HistoryDialog period={period} row={historyFor === "all" ? null : historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function isModified(r: LocalRow): boolean {
  return r.excluded || (Object.keys(r.current) as (keyof DepFields)[]).some((f) => r.current[f] !== r.original[f]);
}

function HistoryDialog({ period, row, onClose }: { period: string; row: LocalRow | null; onClose: () => void }) {
  const [items, setItems] = useState<DepChange[] | null>(null);
  useEffect(() => {
    novedadesApi.get<DepChange[]>("depuration/history", { period, row: row?.id }).then((r) => setItems(r.ok ? r.data : []));
  }, [period, row]);
  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={row ? `Historial · ${row.fullName} ${formatDate(row.date)}` : "Historial de cambios de Horas depuradas"} onClose={onClose} />
      <div className="p-5 text-sm">
        {items === null ? (
          <Spinner className="text-primary" />
        ) : items.length === 0 ? (
          <p className="text-secondary">Sin cambios registrados.</p>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {["Fecha y hora", "Registro", "Campo", "Original", "Anterior", "Nuevo", "Responsable", "Motivo"].map((h) => (
                    <th key={h} className="text-left font-semibold text-secondary border-b border-border px-2 py-1.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td className="border-b border-border px-2 py-1 whitespace-nowrap">{formatDateTime(c.createdAt)}</td>
                    <td className="border-b border-border px-2 py-1">{c.label}</td>
                    <td className="border-b border-border px-2 py-1">{FIELD_LABEL[c.field] ?? c.field}</td>
                    <td className="border-b border-border px-2 py-1 text-secondary">{c.originalValue}</td>
                    <td className="border-b border-border px-2 py-1">{c.oldValue}</td>
                    <td className="border-b border-border px-2 py-1 font-semibold">{c.newValue}</td>
                    <td className="border-b border-border px-2 py-1">{c.actor}</td>
                    <td className="border-b border-border px-2 py-1">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
