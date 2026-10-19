"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Download, Lock, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, novedadesApi } from "./api";
import { ErrorBox } from "./fields";
import { PERM, STATUS_LABEL, type MatrixRow, type WorkedDaysMatrix } from "./types";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SYNC_LABEL,
  isRetryable,
  pendingStore,
  retryDelay,
  type SyncState,
} from "@/lib/novedadesAutosave";
import type { ModuleContext } from "./NovedadesModule";
import StatusChangeDialog from "./StatusChangeDialog";
import ClosePeriodDialog from "./ClosePeriodDialog";
import ImportDialog from "./ImportDialog";
import CorrectionDialog from "./CorrectionDialog";
import { CedulaDialog, WorkedDaysRemovalDialog } from "./CollaboratorAdminDialogs";
import { useDragFill } from "./useDragFill";
import { dragTargets } from "@/lib/dragFill";

type CellError = { collaboratorId: number; date: string; message: string };
const cellKey = (collaboratorId: number, date: string) => `${collaboratorId}|${date}`;
const HOURS_RE = /^\d{0,2}([.,]\d{0,2})?$/;

/** `supervisorId` null = "Todos los supervisores" (Asistente/Administrador):
 * una sola tabla con todos los equipos autorizados; cada fila se guarda en su
 * propio equipo y el cierre, la importación y la exportación siguen siendo
 * por equipo. */
export default function WorkedDaysGrid({ ctx, supervisorId }: { ctx: ModuleContext; supervisorId: number | null }) {
  const { showToast } = useToast();
  const [matrix, setMatrix] = useState<WorkedDaysMatrix | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [sync, setSync] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusTarget, setStatusTarget] = useState<MatrixRow | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [correction, setCorrection] = useState<{ row: MatrixRow; date: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  // Celda activa (para el controlador de relleno) y arrastre tipo Excel con
  // desplazamiento automático, compartido con Horas extras.
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  // Acciones del Administrador sobre una fila: retirar de Días laborados o
  // corregir la cédula (Django vuelve a exigirlo en cada solicitud).
  const [adminAction, setAdminAction] = useState<{ kind: "remove" | "cedula"; row: MatrixRow } | null>(null);
  const isAdmin = ctx.me.nationalWrite && ctx.can(PERM.colaboradores);
  const dragFill = useDragFill({
    containerRef: tableRef,
    onCommit: ({ col, from, to }) => fillColumn(col, from, dragTargets(from, to)),
  });

  // Guardado automático: lo que la persona escribe se conserva aquí (y en el
  // respaldo local) hasta que el servidor lo confirma. Una sola petición en
  // vuelo; lo que llegue mientras tanto se envía en la siguiente.
  const store = useMemo(
    () => pendingStore<Record<string, string>>(`dias|${ctx.period}|${supervisorId ?? "todos"}|${ctx.me.user.id}`),
    [ctx.period, supervisorId, ctx.me.user.id],
  );
  const matrixRef = useRef<WorkedDaysMatrix | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const errorsRef = useRef<Record<string, string>>({});
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    matrixRef.current = matrix;
    draftsRef.current = drafts;
    errorsRef.current = cellErrors;
  }, [matrix, drafts, cellErrors]);

  const pendingCount = Object.keys(drafts).length;

  const fetchMatrix = useCallback(
    () =>
      novedadesApi.get<WorkedDaysMatrix>("worked-days", {
        period: ctx.period,
        supervisor: supervisorId ?? undefined, // sin parámetro = todos los autorizados
      }),
    [ctx.period, supervisorId],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await fetchMatrix();
    if (!mounted.current) return;
    if (result.ok) {
      setMatrix(result.data);
      // Cambios que quedaron sin confirmar (corte de red, cambio de pantalla):
      // se recuperan y se vuelven a enviar solos.
      const restored = store.load() ?? {};
      setDrafts(restored);
      setCellErrors({});
      if (Object.keys(restored).length) {
        setSync("pending");
        schedule(300);
      }
    } else {
      setMatrix(null);
      setLoadError(result.error);
    }
  }, [fetchMatrix, store]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(load);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // Respaldo local de lo pendiente (se borra al confirmarse todo).
  useEffect(() => {
    if (!matrix) return;
    if (pendingCount) store.save(drafts);
    else store.clear();
  }, [drafts, pendingCount, matrix, store]);

  function schedule(delay: number) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), delay);
  }

  async function flush() {
    const current = matrixRef.current;
    if (!current || !current.editable || !mounted.current) return;
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    const entries = Object.entries(draftsRef.current).filter(([k]) => !(k in errorsRef.current));
    if (!entries.length) return;
    inFlight.current = true;
    setSync("saving");
    // Cada celda va al equipo de su fila (en la vista de un solo supervisor,
    // todas al mismo). Un envío por equipo, uno tras otro.
    const bySupervisor = new Map<number, { collaboratorId: number; date: string; hours: string | null; version: number | null }[]>();
    for (const [key, hours] of entries) {
      const [cid, date] = key.split("|");
      const row = current.rows.find((r) => r.collaboratorId === Number(cid));
      const team = row?.supervisorId ?? current.supervisor?.id;
      if (team === undefined) continue;
      const list = bySupervisor.get(team) ?? [];
      list.push({
        collaboratorId: Number(cid),
        date,
        hours: hours.trim() === "" ? null : hours.replace(",", "."),
        // null explícito = la celda estaba vacía al cargar: si otro la llenó
        // entretanto, el servidor responde conflicto en vez de pisarla.
        version: row?.cells[date]?.version ?? null,
      });
      bySupervisor.set(team, list);
    }
    let result: Awaited<ReturnType<typeof novedadesApi.post<{ saved: number }>>> = { ok: true, data: { saved: 0 } };
    for (const [team, cells] of bySupervisor) {
      result = await novedadesApi.post<{ saved: number }>("worked-days/save", {
        period: current.period.code,
        supervisorId: team,
        cells,
      });
      if (!result.ok) break;
    }
    inFlight.current = false;
    if (!mounted.current) return;
    if (result.ok) {
      attempt.current = 0;
      const fresh = await fetchMatrix();
      if (!mounted.current) return;
      if (fresh.ok) setMatrix(fresh.data);
      // Solo se descarta el borrador si sigue siendo el valor enviado: lo que
      // se escribió mientras se guardaba queda pendiente para el próximo envío.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const [key, value] of entries) if (next[key] === value) delete next[key];
        return next;
      });
      setSync("saved");
      setSyncMessage(null);
    } else if (isRetryable(result.status)) {
      setSync("pending");
      setSyncMessage(`${result.error} Los cambios se conservan y se reintentará automáticamente.`);
      schedule(retryDelay(attempt.current++));
    } else {
      const detail = (result.details?.cells as CellError[] | undefined) ?? [];
      if (detail.length) {
        // Rechazo por celda (dato inválido, plazo vencido, fecha futura,
        // conflicto): esas quedan marcadas y conservadas; las demás se
        // vuelven a enviar sin ellas. No se reintenta lo rechazado.
        setCellErrors((prev) => ({
          ...prev,
          ...Object.fromEntries(detail.map((c) => [cellKey(c.collaboratorId, c.date), c.message])),
        }));
        if (result.code === "conflict") {
          const fresh = await fetchMatrix();
          if (mounted.current && fresh.ok) setMatrix(fresh.data);
        }
        setSync("error");
        setSyncMessage(`${detail.length} celda(s) no se guardaron: revise las marcadas en rojo.`);
        rerun.current = true;
      } else {
        setSync("error");
        setSyncMessage(result.error);
      }
    }
    if (rerun.current) {
      rerun.current = false;
      schedule(50);
    }
  }
  useEffect(() => {
    flushRef.current = flush;
  });

  // Al volver la conexión, se envía lo pendiente sin esperar al reintento.
  useEffect(() => {
    const onOnline = () => schedule(0);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Avisa al módulo y al navegador mientras haya cambios sin confirmar (se
  // conservan igual en el respaldo local y se reenvían al volver).
  const { setDirty } = ctx;
  useEffect(() => {
    setDirty(pendingCount > 0);
    if (!pendingCount) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount, setDirty]);

  const rows = useMemo(() => {
    if (!matrix) return [];
    const q = search.trim().toLowerCase();
    if (!q) return matrix.rows;
    return matrix.rows.filter((r) => r.fullName.toLowerCase().includes(q) || r.cedula.includes(q));
  }, [matrix, search]);

  const canCorrectClosed = ctx.can(PERM.corregir) && ctx.me.nationalWrite;
  const canManageCollaborators = ctx.can(PERM.colaboradores) && !ctx.me.isAssistant;
  const isOpen = matrix?.period.status === "OPEN";

  function valueOf(row: MatrixRow, date: string): string {
    const key = cellKey(row.collaboratorId, date);
    if (key in drafts) return drafts[key];
    return row.cells[date]?.hours ?? "";
  }

  /** Misma regla que deshabilita el input: fin de semana, fila no editable,
   * plazo vencido o fecha futura (ya resuelto por el servidor para este
   * usuario), celda de otro equipo, o colaborador no activo sin valor previo.
   * El servidor vuelve a validar cada celda al guardar. */
  function cellBlocked(row: MatrixRow, c: WorkedDaysMatrix["columns"][number]): boolean {
    const rowEditable = row.editable ?? matrix?.editable ?? false;
    const hasValue = (row.cells[c.date]?.hours ?? null) !== null;
    const outOfTerm = c.deadlineState === "future" || c.deadlineState === "expired";
    return (
      c.isWeekend ||
      !rowEditable ||
      outOfTerm ||
      Boolean(row.cells[c.date]?.otherTeam) ||
      (row.status !== "ACTIVE" && !hasValue)
    );
  }

  /** Relleno (arrastre): COPIA el valor de la celda origen en las filas
   * destino de la misma fecha (nunca una serie). Cada destino pasa por
   * `cellBlocked`: las bloqueadas no se tocan y se informan. Los cambios
   * entran como borradores y se guardan en UN solo envío con el guardado
   * automático habitual (lo que el servidor rechace queda marcado en rojo). */
  function fillColumn(colIndex: number, sourceIndex: number, targets: number[]) {
    const column = matrix?.columns[colIndex];
    const source = rows[sourceIndex];
    if (!column || !source) return;
    const value = valueOf(source, column.date);
    const before: Record<string, string | undefined> = {};
    const changes: Record<string, string> = {};
    const originals: Record<string, string> = {};
    let skipped = 0;
    for (const i of targets) {
      const row = rows[i];
      if (!row) continue;
      if (cellBlocked(row, column)) {
        skipped++;
        continue;
      }
      if (valueOf(row, column.date) === value) continue;
      const key = cellKey(row.collaboratorId, column.date);
      before[key] = key in drafts ? drafts[key] : undefined;
      originals[key] = row.cells[column.date]?.hours ?? "";
      changes[key] = value;
    }
    const filled = Object.keys(changes).length;
    if (!filled && !skipped) {
      showToast("Las celdas de destino ya tienen ese valor.", "info");
      return;
    }
    const apply = (values: Record<string, string | undefined>) =>
      setDrafts((prev) => {
        const next = { ...prev };
        for (const [key, v] of Object.entries(values)) {
          if (v === undefined || v === originals[key]) delete next[key];
          else next[key] = v;
        }
        return next;
      });
    apply(changes);
    setCellErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !(k in changes))));
    if (filled) schedule(AUTOSAVE_DEBOUNCE_MS);
    // Deshacer llega casi siempre DESPUÉS del autoguardado (el aviso dura más
    // que AUTOSAVE_DEBOUNCE_MS): para entonces ya no hay borrador que quitar.
    // Se vuelve a escribir el valor previo como borrador para que el guardado
    // automático lo envíe; solo se omite donde el servidor ya lo tiene y no
    // hay un envío en curso que todavía lo vaya a pisar.
    const undo = () => {
      const current = matrixRef.current;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(changes)) {
          const desired = before[key] ?? originals[key];
          const [cid, date] = key.split("|");
          const saved = current?.rows.find((r) => r.collaboratorId === Number(cid))?.cells[date]?.hours ?? "";
          if (desired === saved && !inFlight.current) delete next[key];
          else next[key] = desired;
        }
        return next;
      });
      schedule(AUTOSAVE_DEBOUNCE_MS);
    };
    showToast(
      `${formatDate(column.date)}: valor copiado en ${filled} fila(s)` +
        (skipped ? `; ${skipped} bloqueada(s) sin cambios` : "") +
        ". Se guarda automáticamente.",
      skipped ? "warning" : "success",
      filled
        ? { label: "Deshacer", onClick: undo }
        : undefined,
    );
  }

  function onCellChange(row: MatrixRow, date: string, raw: string) {
    if (!HOURS_RE.test(raw)) return;
    const key = cellKey(row.collaboratorId, date);
    const original = row.cells[date]?.hours ?? "";
    setDrafts((prev) => {
      const next = { ...prev };
      if (raw === original) delete next[key];
      else next[key] = raw;
      return next;
    });
    setCellErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    schedule(AUTOSAVE_DEBOUNCE_MS);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const target = e.currentTarget;
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      Enter: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const move = moves[e.key];
    if (!move) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target.selectionStart !== target.selectionEnd) return;
    e.preventDefault();
    // Moverse confirma la celda: se guarda enseguida.
    schedule(150);
    let [nr, nc] = [r + move[0], c + move[1]];
    // Salta las columnas bloqueadas (sábado/domingo, vencidas, futuras) al moverse en horizontal.
    for (let guard = 0; guard < 60; guard++) {
      const next = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${nr}"][data-c="${nc}"]`);
      if (next && !next.disabled) {
        next.focus();
        next.select();
        return;
      }
      if (!next && move[1] === 0) return;
      nr += move[0];
      nc += move[1];
      if (nc < 0 || nc > 400) return;
    }
  }

  function discardRejected() {
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !(k in cellErrors))));
    setCellErrors({});
    setSync("idle");
    setSyncMessage(null);
  }

  if (loadError) return <ErrorBox message={loadError} />;
  if (!matrix)
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-primary" />
      </div>
    );

  const firstError = Object.values(cellErrors)[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-title">{matrix.supervisor?.name ?? "Todos los supervisores"}</span>
          <span className="text-secondary">· {matrix.period.label}</span>
          {!matrix.supervisor && matrix.supervisorsTotal !== undefined && (
            <span className="text-secondary">
              · {matrix.supervisorsClosed}/{matrix.supervisorsTotal} supervisores cerraron
            </span>
          )}
          {!matrix.supervisor ? null : matrix.period.status === "CLOSED" ? (
            <Badge variant="neutral">
              <Lock className="w-3 h-3" /> Cerrado {formatDateTime(matrix.period.closedAt)} por {matrix.period.closedBy}
            </Badge>
          ) : matrix.period.status === "OPEN" ? (
            <Badge variant="success">Abierto</Badge>
          ) : (
            <Badge variant="warning">No habilitado</Badge>
          )}
          {!matrix.editable && matrix.period.status === "OPEN" && <Badge variant="info">Solo lectura</Badge>}
          <span className="inline-flex items-center gap-1 text-xs text-secondary">
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400" /> Sábado/domingo
            (no editable)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar cédula o nombre…" className="w-56" />
          {!matrix.supervisor && (
            <span className="text-xs text-secondary">Elija un supervisor para importar, exportar o cerrar su período.</span>
          )}
          {matrix.supervisor && ctx.can(PERM.exportar) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const err = await novedadesApi.download(
                  "worked-days/export",
                  { period: matrix.period.code, supervisor: matrix.supervisor?.id },
                  `dias-laborados-${matrix.period.code}.xlsx`,
                );
                if (err) showToast(err, "error");
              }}
            >
              <Download className="w-4 h-4" /> Exportar
            </Button>
          )}
          {matrix.supervisor && matrix.editable && ctx.can(PERM.importar) && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4" /> Importar
            </Button>
          )}
          {matrix.supervisor && (matrix.closable ?? (matrix.editable && ctx.can(PERM.cerrar))) && (
            <Button variant="secondary" size="sm" onClick={() => setCloseOpen(true)} disabled={pendingCount > 0}>
              <Lock className="w-4 h-4" /> Cerrar período
            </Button>
          )}
        </div>
      </div>

      {matrix.editable && (sync !== "idle" || pendingCount > 0) && (
        // Indicador discreto del guardado automático: refleja lo que el
        // servidor confirmó, nunca un éxito anticipado.
        <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite" data-sync={sync}>
          <span
            className={
              sync === "error"
                ? "text-danger font-medium"
                : sync === "pending"
                  ? "text-warning font-medium"
                  : sync === "saved"
                    ? "text-success"
                    : "text-secondary"
            }
          >
            {sync === "pending" || (sync === "idle" && pendingCount)
              ? `${SYNC_LABEL.pending} (${pendingCount})`
              : SYNC_LABEL[sync]}
          </span>
          {syncMessage && <span className="text-secondary">{syncMessage}</span>}
          {sync === "pending" && (
            <button className="text-primary hover:underline" onClick={() => schedule(0)}>
              Reintentar ahora
            </button>
          )}
          {Object.keys(cellErrors).length > 0 && (
            <button className="inline-flex items-center gap-1 text-secondary hover:underline" onClick={discardRejected}>
              <Undo2 className="w-3 h-3" /> Deshacer celdas rechazadas
            </button>
          )}
        </div>
      )}
      <ErrorBox message={firstError} />

      {matrix.rows.length === 0 ? (
        <p className="text-sm text-secondary py-10 text-center">
          {matrix.supervisor
            ? "No hay colaboradores en la base de este supervisor. Regístrelos en “Base de colaboradores”."
            : "No hay colaboradores en las bases de los supervisores autorizados para este período."}
        </p>
      ) : (
        <div ref={tableRef} className="overflow-auto max-h-[65vh] border border-border rounded-xl bg-surface">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                {["Supervisor", "Cargo"].map((h) => (
                  <th key={h} rowSpan={2} className="sticky top-0 z-20 bg-surface2 border-b border-r border-border px-2 py-1.5 text-left font-semibold text-secondary whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th rowSpan={2} className="sticky top-0 left-0 z-30 bg-surface2 border-b border-r border-border px-2 py-1.5 text-left font-semibold text-secondary w-[96px] min-w-[96px]">
                  Cédula
                </th>
                <th rowSpan={2} className="sticky top-0 left-[96px] z-30 bg-surface2 border-b border-r border-border px-2 py-1.5 text-left font-semibold text-secondary min-w-[240px] whitespace-nowrap">
                  Empleado
                </th>
                {matrix.columns.map((c) => (
                  <th
                    key={c.date}
                    title={`${c.weekday} ${formatDate(c.date)}${c.holiday ? ` · Feriado: ${c.holiday}` : ""}`}
                    className={`sticky top-0 z-20 border-b border-r border-border px-1 py-1 text-center font-semibold min-w-[44px] ${
                      c.isWeekend ? "bg-yellow-200 text-yellow-900" : c.holiday ? "bg-primary-surface text-primary" : "bg-surface2 text-secondary"
                    }`}
                  >
                    <div>{String(c.day).padStart(2, "0")}</div>
                    <div className="font-normal text-[10px]">{c.weekday.slice(0, 3)}</div>
                  </th>
                ))}
                <th rowSpan={2} className="sticky top-0 z-20 bg-surface2 border-b border-border px-2 py-1.5 text-right font-semibold text-secondary">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => {
                const canCorrect = canCorrectClosed && (row.periodStatus ?? matrix.period.status) === "CLOSED";
                return (
                  <tr key={row.collaboratorId} data-row={r} className="group">
                    <td className="border-b border-r border-border px-2 py-1 whitespace-nowrap text-secondary">
                      {row.supervisorName ?? matrix.supervisor?.name}
                    </td>
                    <td className="border-b border-r border-border px-2 py-1 whitespace-nowrap">{row.cargo}</td>
                    <td className="sticky left-0 z-10 bg-surface border-b border-r border-border px-2 py-1 font-mono w-[96px] min-w-[96px]">
                      {isAdmin ? (
                        <button
                          className="font-mono hover:text-primary hover:underline"
                          title="Corregir cédula (Administrador)"
                          aria-label={`Corregir cédula de ${row.fullName}`}
                          onClick={() => setAdminAction({ kind: "cedula", row })}
                        >
                          {row.cedula}
                        </button>
                      ) : (
                        row.cedula
                      )}
                    </td>
                    <td className="sticky left-[96px] z-10 bg-surface border-b border-r border-border px-2 py-1 min-w-[240px]">
                      {/* Nombre completo, sin recortar: la columna crece con el
                          nombre más largo y las fechas se recorren con el
                          desplazamiento horizontal. */}
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span title={row.fullName}>{row.fullName}</span>
                        {row.status !== "ACTIVE" && (
                          <Badge variant={row.status === "SUSPENDED" ? "warning" : "neutral"}>{STATUS_LABEL[row.status]}</Badge>
                        )}
                        {canManageCollaborators && row.isCurrentMember && isOpen && (
                          <button
                            onClick={() => setStatusTarget(row)}
                            className="ml-auto text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Cambiar estado operativo"
                          >
                            Estado
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => setAdminAction({ kind: "remove", row })}
                            className={`${canManageCollaborators && row.isCurrentMember && isOpen ? "" : "ml-auto "}text-[10px] text-danger hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100`}
                            title="Retirar de Días laborados (Administrador; no borra información)"
                            aria-label={`Retirar a ${row.fullName} de Días laborados`}
                          >
                            Retirar
                          </button>
                        )}
                      </div>
                    </td>
                    {matrix.columns.map((c, ci) => {
                      const key = cellKey(row.collaboratorId, c.date);
                      const value = valueOf(row, c.date);
                      const dirty = key in drafts;
                      const error = cellErrors[key];
                      const otherTeam = row.cells[c.date]?.otherTeam;
                      const blocked = cellBlocked(row, c);
                      const inDrag = dragFill.inDrag(r, ci);
                      const showHandle =
                        active?.r === r && active?.c === ci && !dragFill.drag && !blocked && value.trim() !== "";
                      if (canCorrect && !c.isWeekend) {
                        return (
                          <td key={c.date} className="border-b border-r border-border p-0 text-center">
                            <button
                              className="w-full h-7 hover:bg-primary-surface"
                              title="Corrección autorizada (período cerrado)"
                              onClick={() => setCorrection({ row, date: c.date })}
                            >
                              {value}
                            </button>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c.date}
                          className={`relative border-b border-r border-border p-0 ${c.isWeekend ? "bg-yellow-200" : ""} ${
                            inDrag
                              ? "bg-primary-surface outline outline-1 outline-dashed outline-primary -outline-offset-1"
                              : error
                                ? "bg-danger/[.15]"
                                : dirty
                                  ? "bg-warning/[.18]"
                                  : ""
                          }`}
                          title={
                            error ??
                            (c.isWeekend
                              ? "Sábado/domingo: no admite registros"
                              : c.deadlineState === "future"
                                ? "Fecha futura: no se registran novedades por adelantado"
                                : c.deadlineState === "expired"
                                  ? `Plazo vencido el ${c.deadlineLabel}: solicite la corrección al Asistente de Operaciones o al Administrador`
                                  : c.deadlineState === "late"
                                    ? `Plazo vencido el ${c.deadlineLabel}: su corrección queda registrada como fuera de plazo`
                                    : otherTeam
                                ? `Registrado por el equipo de ${otherTeam} (colaborador reasignado): no se modifica desde aquí`
                                : undefined)
                          }
                        >
                          <input
                            data-r={r}
                            data-c={ci}
                            value={value}
                            disabled={blocked}
                            inputMode="decimal"
                            aria-label={`${row.fullName} ${formatDate(c.date)}`}
                            onChange={(e) => onCellChange(row, c.date, e.target.value)}
                            onBlur={() => schedule(150)}
                            onKeyDown={onKeyDown}
                            onFocus={(e) => {
                              setActive({ r, c: ci });
                              e.target.select();
                            }}
                            className={`w-full h-7 px-1 text-center bg-transparent focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset ${
                              c.isWeekend ? "cursor-not-allowed text-yellow-900" : blocked ? "cursor-not-allowed text-secondary" : "text-title"
                            }`}
                          />
                          {showHandle && (
                            <span
                              role="button"
                              tabIndex={-1}
                              aria-label={`Arrastre para copiar ${value} a otras filas (Esc cancela)`}
                              title="Arrastre para copiar este valor a otras filas"
                              onMouseDown={(e) => dragFill.start(e, r, ci)}
                              className="absolute -bottom-1 -right-1 z-10 w-2.5 h-2.5 bg-primary border border-white cursor-crosshair"
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-border px-2 py-1 text-right font-semibold">{row.totalHours}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adminAction?.kind === "remove" && (
        <WorkedDaysRemovalDialog
          collaborator={{ id: adminAction.row.collaboratorId, fullName: adminAction.row.fullName, cedula: adminAction.row.cedula }}
          onClose={() => setAdminAction(null)}
          onDone={() => {
            setAdminAction(null);
            load();
          }}
        />
      )}
      {adminAction?.kind === "cedula" && (
        <CedulaDialog
          collaborator={{ id: adminAction.row.collaboratorId, fullName: adminAction.row.fullName, cedula: adminAction.row.cedula }}
          onClose={() => setAdminAction(null)}
          onDone={() => {
            setAdminAction(null);
            load();
          }}
        />
      )}
      {statusTarget && (
        <StatusChangeDialog
          collaborator={{ id: statusTarget.collaboratorId, fullName: statusTarget.fullName, status: statusTarget.status }}
          onClose={() => setStatusTarget(null)}
          onDone={() => {
            setStatusTarget(null);
            load();
          }}
        />
      )}
      {closeOpen && matrix.supervisor && (
        <ClosePeriodDialog
          period={matrix.period.code}
          supervisorId={matrix.supervisor.id}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false);
            ctx.refreshPeriods();
            load();
          }}
        />
      )}
      {importOpen && matrix.supervisor && (
        <ImportDialog
          kind="WORKED_DAYS"
          period={matrix.period.code}
          supervisorId={matrix.supervisor.id}
          periodRange={{ startDate: matrix.period.startDate, endDate: matrix.period.endDate, label: matrix.period.label }}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            load();
          }}
        />
      )}
      {correction && (
        <CorrectionDialog
          target="WORKED_DAY"
          title={`${correction.row.fullName} · ${formatDate(correction.date)}`}
          currentValue={correction.row.cells[correction.date]?.hours ?? ""}
          payload={{
            collaboratorId: correction.row.collaboratorId,
            supervisorId: correction.row.supervisorId ?? matrix.supervisor?.id ?? 0,
            date: correction.date,
          }}
          onClose={() => setCorrection(null)}
          onDone={() => {
            setCorrection(null);
            load();
          }}
        />
      )}
    </div>
  );
}
