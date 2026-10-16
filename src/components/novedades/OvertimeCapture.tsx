"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ArrowDownToLine, ClipboardPaste, Download, FileSpreadsheet, Plus, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { useToast } from "@/components/ui/Toast";
import {
  CAPTURE_COLUMNS,
  applyPaste,
  copyColumnRange,
  duplicateKeysOf,
  fillColumn,
  isFillableColumn,
  isoWeekday,
  newRowKey,
  rowFromCollaborator,
  rowsFromPastedTable,
  summarize,
  validateRow,
  type CaptureRow,
  type CollaboratorRef,
} from "@/lib/novedadesCapture";
import { formatDate, novedadesApi } from "./api";
import { ErrorBox, Label, TextArea, TextInput } from "./fields";
import { PERM, type OvertimeMonth, type OvertimeRecord } from "./types";
import type { ModuleContext } from "./NovedadesModule";
import ImportDialog from "./ImportDialog";
import { useDragFill } from "./useDragFill";
import { dragTargets } from "@/lib/dragFill";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SYNC_LABEL,
  isRetryable,
  pendingStore,
  retryDelay,
  type SyncState,
} from "@/lib/novedadesAutosave";
import OvertimeDeleteDialog, { type OvertimeDeleteTarget } from "./OvertimeDeleteDialog";

type RowResult = {
  clientKey: string;
  status: "created" | "updated" | "unchanged" | "error" | "duplicate" | "conflict" | "locked";
  errors: Record<string, string>;
  recordId?: number;
  version?: number;
};
type BulkResponse = { summary: { created: number; updated: number; unchanged: number; errors: number }; rows: RowResult[] };

const BATCH = 500;

const STATE_LABEL: Record<string, { text: string; variant: "info" | "warning" | "success" | "danger" | "neutral" }> = {
  new: { text: "Nueva", variant: "info" },
  modified: { text: "Modificada", variant: "warning" },
  saved: { text: "Guardada", variant: "success" },
  error: { text: "Error", variant: "danger" },
  locked: { text: "Bloqueada", variant: "neutral" },
  clean: { text: "Sin cambios", variant: "neutral" },
};

function stateOf(row: CaptureRow) {
  if (row.state === "locked") return "locked";
  if (Object.keys(row.errors).length) return "error";
  if (row.dirty) return row.id === null ? "new" : "modified";
  return row.state === "saved" ? "saved" : "clean";
}

function recordToRow(r: OvertimeRecord): CaptureRow {
  return {
    key: `r${r.id}`,
    id: r.id,
    version: r.version,
    collaboratorId: r.collaboratorId,
    cedula: r.cedula,
    fullName: r.fullName,
    regional: r.regional,
    area: r.area,
    cargo: r.cargo,
    date: r.date,
    overtimeHours: r.overtimeHours === "0" ? "" : r.overtimeHours,
    saturdayHours: r.saturdayHours === "0" ? "" : r.saturdayHours,
    isSaturday: r.isSaturday,
    isSunday: r.isSunday,
    isHoliday: r.isHoliday,
    workDone: r.workDone,
    observations: r.observations,
    state: "existing",
    dirty: false,
    errors: {},
  };
}

export default function OvertimeCapture({
  ctx,
  supervisorId,
  month,
}: {
  ctx: ModuleContext;
  /** null = "Todos los supervisores": colaboradores de todos los equipos autorizados. */
  supervisorId: number | null;
  /** Mes calendario elegido, con el estado que calcula Django. */
  month: OvertimeMonth;
}) {
  const { showToast } = useToast();
  const [team, setTeam] = useState<CollaboratorRef[]>([]);
  // Respaldo local de lo que quedó sin confirmar: se recupera AL CREAR el
  // estado (antes de cualquier efecto). Si se leyera en un efecto, el efecto
  // que guarda el respaldo correría antes con la tabla vacía y lo borraría.
  const storeScope = `horas|${month.code}|${supervisorId ?? "todos"}|${ctx.me.user.id}`;
  const [restored] = useState<CaptureRow[]>(() => pendingStore<CaptureRow[]>(storeScope).load() ?? []);
  const [rows, setRows] = useState<CaptureRow[]>(restored);
  // Fecha de trabajo por defecto: hoy si cae en el mes elegido; si no, el día 1
  // (la captura se monta de nuevo al cambiar de mes: ver `key` en OvertimeView).
  const [defaultDate, setDefaultDate] = useState(() => {
    const now = new Date();
    // Día LOCAL del navegador: `toISOString()` es UTC y desde las 19:00 de
    // Ecuador ya devuelve el día siguiente.
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return today >= month.startDate && today <= month.endDate ? today : month.startDate;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Celda activa y rango vertical (una columna) para el relleno tipo Excel.
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [range, setRange] = useState<{ c: number; r1: number; r2: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sync, setSync] = useState<SyncState>(restored.length ? "pending" : "idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(
    restored.length ? "Se recuperaron cambios que no se habían confirmado; se envían automáticamente." : null,
  );
  // Guardado automático: una sola petición en vuelo; lo que cambie mientras
  // tanto se envía en la siguiente. Respaldo local de las filas pendientes.
  const store = useMemo(() => pendingStore<CaptureRow[]>(storeScope), [storeScope]);
  const rowsRef = useRef<CaptureRow[]>([]);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const flushRef = useRef<() => void>(() => {});
  const [deleting, setDeleting] = useState<{ key: string; target: OvertimeDeleteTarget } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  // Arrastre del controlador de relleno, con desplazamiento automático de la
  // tabla (compartido con Días laborados): al soltar, copia la celda origen en
  // el rango con las mismas reglas de `fill`.
  const dragFill = useDragFill({
    containerRef: tableRef,
    onCommit: ({ col, from, to }) => {
      fill(col, from, dragTargets(from, to));
      setRange({ c: col, r1: from, r2: to });
    },
  });
  const drag = dragFill.drag;

  // El Asistente de Operaciones también registra y corrige fechas pasadas
  // (decisión del 2026-10-13); el servidor revalida plazo, equipo y cierre.
  const canWrite = ctx.can(PERM.registrar);
  // Horas extras va por mes calendario: solo el cierre manual del mes bloquea
  // (un plazo vencido sin cerrar sigue editable). El servidor vuelve a validar.
  const period = month;
  const isOpen = month.status !== "CLOSED" && month.status !== "FUTURE";
  const editable = useCallback((row: CaptureRow) => Boolean(canWrite && isOpen && row.state !== "locked"), [canWrite, isOpen]);

  // Equipo del supervisor: se carga una vez por equipo.
  useEffect(() => {
    novedadesApi
      .get<CollaboratorRef[]>("collaborators", { status: "ACTIVE", supervisor: supervisorId ?? undefined })
      .then((r) => r.ok && setTeam(r.data));
  }, [supervisorId]);

  const dupKeys = useMemo(() => duplicateKeysOf(rows), [rows]);
  // Validación en vivo (ayuda): solo para filas con cambios pendientes.
  const validated = useMemo(
    () =>
      rows.map((r) => {
        if (!period || !r.dirty || r.state === "locked") return r;
        const local = validateRow(r, period, dupKeys, ctx.me.deadlineRules);
        const server = r.state === "error" ? r.errors : {};
        return { ...r, errors: { ...server, ...local } };
      }),
    [rows, period, dupKeys, ctx.me.deadlineRules],
  );
  const summary = useMemo(() => summarize(validated, dupKeys), [validated, dupKeys]);
  const pendingCount = validated.filter((r) => r.dirty).length;

  const { setDirty } = ctx;
  useEffect(() => {
    setDirty(pendingCount > 0);
    if (!pendingCount) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount, setDirty]);

  // Editar una fila la vuelve "pendiente" y limpia los errores del servidor:
  // se revalida en vivo y otra vez al guardar.
  const touched = (r: CaptureRow): CaptureRow => ({
    ...r,
    rev: (r.rev ?? 0) + 1,
    dirty: true,
    errors: {},
    state: r.state === "locked" ? "locked" : r.id === null ? "new" : "existing",
  });

  function update(key: string, patch: Partial<CaptureRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? touched({ ...r, ...patch }) : r)));
  }

  function addCollaborators(ids: number[]) {
    const chosen = team.filter((c) => ids.includes(c.id));
    setRows((prev) => [...prev, ...chosen.map((c) => rowFromCollaborator(c, defaultDate))]);
    showToast(`${chosen.length} fila(s) agregada(s) con fecha ${formatDate(defaultDate)}.`, "info");
  }

  async function loadExisting() {
    if (!defaultDate) return;
    const r = await novedadesApi.get<{ records: OvertimeRecord[] }>("overtime", {
      period: month.code,
      supervisor: supervisorId ?? undefined,
      date_from: defaultDate,
      date_to: defaultDate,
      limit: 1000,
    });
    if (!r.ok) return showToast(r.error, "error");
    const present = new Set(rows.map((x) => x.id).filter(Boolean));
    const fresh = r.data.records.filter((x) => !present.has(x.id)).map(recordToRow);
    setRows((prev) => [...prev, ...fresh]);
    showToast(fresh.length ? `${fresh.length} registro(s) existentes cargados para editar.` : "No hay registros nuevos de esa fecha.", "info");
  }

  function removeSelected() {
    const removing = rows.filter((r) => selected.has(r.key));
    if (removing.some((r) => r.dirty) && !window.confirm("Hay filas con cambios sin guardar. ¿Quitarlas de la tabla?")) return;
    setRows((prev) => prev.filter((r) => !selected.has(r.key)));
    setSelected(new Set());
  }

  function dropRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setActive(null);
    setRange(null);
  }

  // Eliminar UNA fila: si nunca se guardó solo se quita de la tabla (no hay
  // nada en el servidor); si ya está guardada se confirma y se elimina en
  // Django (borrado lógico, alerta al Administrador). Nunca toca la base de
  // colaboradores.
  function deleteRow(row: CaptureRow) {
    if (row.id === null) {
      dropRow(row.key);
      showToast(`Fila de ${row.fullName} quitada (no estaba guardada).`, "info", {
        label: "Deshacer",
        onClick: () => setRows((prev) => (prev.some((r) => r.key === row.key) ? prev : [...prev, row])),
      });
      return;
    }
    if (row.dirty && !window.confirm("Esta fila tiene cambios sin guardar que se perderán. ¿Continuar con la eliminación?")) return;
    setDeleting({
      key: row.key,
      target: {
        id: row.id,
        fullName: row.fullName,
        cedula: row.cedula,
        date: row.date,
        overtimeHours: row.overtimeHours,
        saturdayHours: row.saturdayHours,
      },
    });
  }

  function applyDateToSelected() {
    const targets = rows.filter((r) => selected.has(r.key) && editable(r));
    if (!targets.length) return;
    if (!window.confirm(`Aplicar ${formatDate(defaultDate)} a ${targets.length} fila(s) seleccionada(s)? Se recalculan las marcas de sábado y domingo.`)) return;
    const wd = isoWeekday(defaultDate);
    setRows((prev) =>
      prev.map((r) =>
        selected.has(r.key) && editable(r)
          ? { ...r, date: defaultDate, isSaturday: wd === 6, isSunday: wd === 0, isHoliday: null, dirty: true, errors: {} }
          : r,
      ),
    );
  }

  // Relleno: COPIA el valor de la celda origen en las filas destino de la
  // misma columna (nunca genera una serie). Solo cambia el estado de la tabla;
  // se guarda con el botón Guardar habitual, en un solo lote.
  function fill(colIndex: number, sourceIndex: number, targets: number[]) {
    const snapshot = rows;
    const result = fillColumn(rows, colIndex, sourceIndex, targets, editable);
    if (!result.filled && !result.skipped) {
      showToast("Las celdas de destino ya tienen ese valor.", "info");
      return;
    }
    setRows(result.rows);
    const header = CAPTURE_COLUMNS[colIndex].header;
    const field = CAPTURE_COLUMNS[colIndex].field!;
    const changed = new Set(targets);
    showToast(
      `${header}: valor copiado en ${result.filled} fila(s)` +
        (result.skipped ? `; ${result.skipped} bloqueada(s) sin cambios` : "") +
        ". Pendiente de guardar.",
      result.skipped ? "warning" : "success",
      {
        label: "Deshacer",
        onClick: () =>
          setRows((current) =>
            current.map((row, i) => {
              const before = snapshot[i];
              if (!changed.has(i) || !before || before.key !== row.key) return row;
              return { ...row, [field]: before[field], dirty: before.dirty, state: before.state, errors: before.errors };
            }),
          ),
      },
    );
  }

  const rangeRows = (rg: { r1: number; r2: number }) => {
    const [a, b] = rg.r1 <= rg.r2 ? [rg.r1, rg.r2] : [rg.r2, rg.r1];
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  };

  /** Rellenar hacia abajo: con un rango vertical, copia la primera celda del
   * rango en el resto; si no hay rango pero hay filas marcadas, copia la celda
   * activa en esas filas; si no, copia la celda de arriba en la activa (Ctrl+D
   * de Excel). */
  function fillDown() {
    if (!active || !isFillableColumn(active.c)) {
      showToast("Seleccione una celda de horas, SABADO/DOMINGO/FERIADO o texto.", "info");
      return;
    }
    if (range && range.c === active.c && range.r1 !== range.r2) {
      const targets = rangeRows(range);
      fill(active.c, targets[0], targets.slice(1));
      return;
    }
    const checked = rows.map((r, i) => (selected.has(r.key) ? i : -1)).filter((i) => i >= 0 && i !== active.r);
    if (checked.length) {
      fill(active.c, active.r, checked);
      return;
    }
    if (active.r > 0) fill(active.c, active.r - 1, [active.r]);
  }

  function onCellKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const t = e.currentTarget;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      fillDown();
      return;
    }
    if (mod && e.key.toLowerCase() === "c" && range && range.r1 !== range.r2) {
      e.preventDefault();
      navigator.clipboard?.writeText(copyColumnRange(rows, range.c, range.r1, range.r2));
      showToast(`${rangeRows(range).length} celda(s) copiadas.`, "info");
      return;
    }
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const anchor = range && range.c === c ? range : { c, r1: r, r2: r };
      const r2 = Math.max(0, Math.min(rows.length - 1, anchor.r2 + (e.key === "ArrowDown" ? 1 : -1)));
      setRange({ c, r1: anchor.r1, r2 });
      return;
    }
    const move: Record<string, [number, number]> = { ArrowDown: [1, 0], Enter: [1, 0], ArrowUp: [-1, 0] };
    const atStart = t.type !== "text" || t.selectionStart === 0;
    const atEnd = t.type !== "text" || t.selectionEnd === t.value.length;
    if (e.key === "ArrowRight" && atEnd) move.ArrowRight = [0, 1];
    if (e.key === "ArrowLeft" && atStart) move.ArrowLeft = [0, -1];
    const delta = move[e.key];
    if (!delta) return;
    let [nr, nc] = [r + delta[0], c + delta[1]];
    for (let guard = 0; guard < 20; guard++) {
      const next = tableRef.current?.querySelector<HTMLInputElement>(`[data-r="${nr}"][data-c="${nc}"]`);
      if (next && !next.disabled) {
        e.preventDefault();
        next.focus();
        if (next.type === "text") next.select();
        return;
      }
      if (delta[1] === 0) return;
      nc += delta[1];
      if (nc < 0 || nc >= CAPTURE_COLUMNS.length) return;
      nr += delta[0];
    }
  }

  function onCellPaste(e: ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const block = text.replace(/\r/g, "").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).map((l) => l.split("\t"));
    const result = applyPaste(rows, rowIndex, colIndex, block, editable);
    setRows(result.rows.map((r, i) => (r.dirty && rows[i] && JSON.stringify(r) !== JSON.stringify(rows[i]) ? touched(r) : r)));
    const notes = [
      result.invalid ? `${result.invalid} valor(es) no reconocidos (use números, SI/NO y fechas dd/mm/aaaa)` : "",
      result.skippedRows ? `${result.skippedRows} fila(s) del portapapeles sobran: agregue primero los colaboradores` : "",
    ].filter(Boolean);
    showToast(notes.length ? `Pegado con observaciones: ${notes.join("; ")}.` : "Datos pegados.", notes.length ? "warning" : "success");
  }

  function schedule(delay: number) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), delay);
  }

  /** Filas listas para enviarse: con cambios, válidas y no bloqueadas. Las
   * incompletas quedan como borrador (no se crea nada inválido). */
  function sendable(list: CaptureRow[]): CaptureRow[] {
    const dups = duplicateKeysOf(list);
    return list.filter(
      (r) =>
        r.dirty &&
        r.state !== "locked" &&
        r.state !== "error" &&
        Object.keys(validateRow(r, period, dups, ctx.me.deadlineRules)).length === 0,
    );
  }

  async function flush() {
    if (!mounted.current || !canWrite || !isOpen) return;
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    const toSend = sendable(rowsRef.current);
    if (!toSend.length) return;
    inFlight.current = true;
    setSync("saving");
    const sentRev = new Map(toSend.map((r) => [r.key, r.rev ?? 0]));
    const results = new Map<string, RowResult>();
    let failure: { status: number; error: string } | null = null;
    for (let start = 0; start < toSend.length; start += BATCH) {
      const chunk = toSend.slice(start, start + BATCH);
      const response = await novedadesApi.post<BulkResponse>("overtime/bulk", {
        period: month.code,
        rows: chunk.map((r) => ({
          clientKey: r.key,
          id: r.id,
          version: r.version,
          collaboratorId: r.collaboratorId,
          date: r.date,
          overtimeHours: r.overtimeHours,
          saturdayHours: r.saturdayHours,
          isSaturday: r.isSaturday,
          isSunday: r.isSunday,
          isHoliday: r.isHoliday,
          workDone: r.workDone,
          observations: r.observations,
        })),
      });
      if (!response.ok) {
        // Nada se borra: las filas quedan en la tabla (y en el respaldo
        // local) y el reintento no duplica: el servidor reconoce lo guardado.
        failure = { status: response.status, error: response.error };
        break;
      }
      response.data.rows.forEach((r) => results.set(r.clientKey, r));
    }
    inFlight.current = false;
    if (!mounted.current) return;
    applyResults(results, sentRev);
    const values = [...results.values()];
    const rejected = values.filter((r) => !["created", "updated", "unchanged"].includes(r.status)).length;
    if (failure && isRetryable(failure.status)) {
      setSync("pending");
      setSyncMessage(`${failure.error} Los cambios se conservan y se reintentará automáticamente.`);
      schedule(retryDelay(attempt.current++));
    } else if (failure) {
      setSync("error");
      setSyncMessage(failure.error);
    } else if (rejected) {
      // Guardado parcial: nunca se presenta como éxito total.
      setSync("error");
      setSyncMessage(`${values.length - rejected} fila(s) guardadas; ${rejected} no se guardaron: revise las marcadas.`);
      attempt.current = 0;
    } else {
      setSync("saved");
      setSyncMessage(null);
      attempt.current = 0;
    }
    if (rerun.current) {
      rerun.current = false;
      schedule(50);
    }
  }

  function applyResults(results: Map<string, RowResult>, sentRev: Map<string, number>) {
    if (!results.size) return;
    setRows((prev) =>
      prev.map((r) => {
        const res = results.get(r.key);
        if (!res) return r;
        const current = (r.rev ?? 0) === sentRev.get(r.key);
        if (["created", "updated", "unchanged"].includes(res.status)) {
          const saved = { ...r, id: res.recordId ?? r.id, version: res.version ?? r.version };
          // Si la fila cambió mientras se guardaba, se conserva la edición
          // nueva como pendiente (con el id/versión ya confirmados).
          return current ? { ...saved, state: "saved", dirty: false, errors: {} } : saved;
        }
        if (!current) return r;
        return { ...r, state: res.status === "locked" ? "locked" : "error", errors: res.errors as CaptureRow["errors"] };
      }),
    );
  }

  useEffect(() => {
    rowsRef.current = rows;
    flushRef.current = flush;
  });

  // Cada cambio válido se envía solo, tras una breve pausa (no por tecla).
  useEffect(() => {
    if (sendable(rows).length) schedule(AUTOSAVE_DEBOUNCE_MS);
    // `sendable` y `schedule` solo leen props/refs estables para este render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Respaldo local de lo pendiente; se recupera al volver a la pantalla.
  useEffect(() => {
    const pending = rows.filter((r) => r.dirty);
    if (pending.length) store.save(pending);
    else store.clear();
  }, [rows, store]);

  useEffect(() => {
    mounted.current = true;
    const onOnline = () => schedule(0);
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
    };
    // Solo al montar (la captura se monta de nuevo por mes y equipo).
     
  }, [store]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const errorList = validated.flatMap((r, i) =>
    Object.entries(r.errors).map(([field, msg]) => ({ i, name: r.fullName, field, msg })),
  );
  const fieldHeader = (field: string) => CAPTURE_COLUMNS.find((c) => c.field === field)?.header ?? (field === "row" ? "Fila" : "Colaborador");

  return (
    <div className="space-y-3">
      {month.status === "CLOSED" && (
        <ErrorBox message={`${month.label} de Horas extras está cerrado para este equipo: la captura ordinaria está bloqueada.`} />
      )}
      {!canWrite && <ErrorBox message="No tiene habilitado el registro de novedades." />}

      <div className="flex flex-wrap items-end gap-2">
        <label>
          <Label>Fecha de trabajo (filas nuevas)</Label>
          <TextInput
            type="date"
            value={defaultDate}
            min={period.startDate}
            max={period.endDate}
            onChange={(e) => setDefaultDate(e.target.value)}
            className="w-44"
          />
        </label>
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={!canWrite || !isOpen}>
          <Plus className="w-4 h-4" /> Agregar colaboradores
        </Button>
        <Button size="sm" variant="secondary" onClick={loadExisting}>
          <RotateCw className="w-4 h-4" /> Cargar registros de la fecha
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)} disabled={!canWrite || !isOpen}>
          <ClipboardPaste className="w-4 h-4" /> Pegar desde Excel
        </Button>
        {ctx.can(PERM.importar) && (
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)} disabled={!canWrite || !isOpen}>
            <Upload className="w-4 h-4" /> Importar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => novedadesApi.download("overtime/template", {}, "plantilla-horas-extras.xlsx")}
        >
          <Download className="w-4 h-4" /> Plantilla
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={fillDown}
            disabled={!canWrite || !isOpen || !active || !isFillableColumn(active.c)}
            title="Copia el valor de la celda activa en el rango seleccionado (Mayús+clic o Mayús+↓) o en las filas marcadas. Atajo: Ctrl+D"
          >
            <ArrowDownToLine className="w-4 h-4" /> Rellenar hacia abajo
          </Button>
          <Button size="sm" variant="ghost" onClick={applyDateToSelected} disabled={!selected.size}>
            Aplicar fecha a seleccionadas
          </Button>
          <Button size="sm" variant="ghost" onClick={removeSelected} disabled={!selected.size}>
            <Trash2 className="w-4 h-4" /> Quitar seleccionadas
          </Button>
        </div>
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm border ${
          pendingCount ? "border-warning/40 bg-warning/[.08]" : "border-border bg-surface2"
        }`}
        aria-live="polite"
      >
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>Nuevas: <strong>{summary.newRows}</strong></span>
          <span>Modificadas: <strong>{summary.modified}</strong></span>
          <span>Válidas: <strong>{summary.valid}</strong></span>
          <span>Con errores: <strong className={summary.withErrors ? "text-danger" : ""}>{summary.withErrors}</strong></span>
          <span>Posibles duplicados: <strong className={summary.duplicates ? "text-danger" : ""}>{summary.duplicates}</strong></span>
          <span>Bloqueadas: <strong>{summary.locked}</strong></span>
        </span>
        <div className="flex gap-2">
          {/* Indicador discreto del guardado automático (estado real del servidor). */}
          <span
            data-sync={sync}
            className={`text-xs self-center ${
              sync === "error" ? "text-danger font-medium" : sync === "pending" ? "text-warning font-medium" : sync === "saved" ? "text-success" : "text-secondary"
            }`}
          >
            {sync === "idle" && pendingCount ? `Borradores: ${pendingCount}` : SYNC_LABEL[sync]}
          </span>
          {sync === "pending" && (
            <Button size="sm" variant="ghost" onClick={() => schedule(0)}>
              Reintentar ahora
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!pendingCount || sync === "saving"}
            onClick={() => {
              if (window.confirm("¿Descartar los borradores sin guardar? Esas filas se quitan de la tabla.")) {
                setRows((prev) => prev.filter((r) => !r.dirty));
              }
            }}
          >
            Descartar borradores
          </Button>
        </div>
      </div>
      {syncMessage && <p className="text-xs text-secondary" aria-live="polite">{syncMessage}</p>}
      {rows.length > 0 && canWrite && isOpen && (
        <p className="text-[11px] text-secondary">
          Relleno tipo Excel: arrastre el cuadrito azul de la celda activa hacia abajo (Esc cancela), o elija el rango con
          Mayús+clic / Mayús+↓ y pulse Ctrl+D o “Rellenar hacia abajo”. Con filas marcadas, el valor se copia a esas filas.
          Siempre se copia el mismo valor (2, 2, 2), nunca una serie. Fecha e identidad no se rellenan.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-12 text-center text-sm text-secondary space-y-1">
          <FileSpreadsheet className="w-6 h-6 mx-auto text-primary" />
          <p>Elija la fecha de trabajo y pulse “Agregar colaboradores” para crear una fila por persona.</p>
          <p className="text-xs">También puede pegar filas desde Excel o cargar los registros existentes de esa fecha para editarlos.</p>
        </div>
      ) : (
        <div ref={tableRef} className="overflow-auto max-h-[62vh] border border-border rounded-xl bg-surface">
          <table className="border-separate border-spacing-0 text-xs min-w-full">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-surface2 border-b border-r border-border px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las filas"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())}
                  />
                </th>
                <th className="sticky top-0 z-20 bg-surface2 border-b border-r border-border px-2 py-2 text-left text-secondary font-semibold">Estado</th>
                {CAPTURE_COLUMNS.map((c) => (
                  <th
                    key={c.header}
                    className={`sticky top-0 z-20 border-b border-r border-border px-2 py-2 text-left font-semibold whitespace-nowrap ${
                      c.field ? "bg-surface2 text-title" : "bg-surface2 text-secondary"
                    }`}
                  >
                    {c.header}
                  </th>
                ))}
                <th className="sticky top-0 z-20 bg-surface2 border-b border-border px-2 py-2 text-secondary font-semibold">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {validated.map((row, r) => {
                const st = stateOf(row);
                const canEdit = editable(row);
                const cls = (field: string) =>
                  `w-full h-7 px-1.5 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset ${
                    row.errors[field as keyof CaptureRow["errors"]] ? "ring-1 ring-danger ring-inset bg-danger/[.08]" : ""
                  }`;
                return (
                  <tr key={row.key} data-row={r} className={st === "error" ? "bg-danger/[.04]" : st === "saved" ? "bg-success/[.04]" : ""}>
                    <td className="sticky left-0 z-10 bg-surface border-b border-r border-border px-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${row.fullName}`}
                        checked={selected.has(row.key)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.key);
                            else next.delete(row.key);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="border-b border-r border-border px-2 whitespace-nowrap" title={Object.values(row.errors).join(" · ")}>
                      <Badge variant={STATE_LABEL[st].variant}>{STATE_LABEL[st].text}</Badge>
                    </td>
                    {CAPTURE_COLUMNS.map((col, c) => {
                      const base = "border-b border-r border-border p-0";
                      if (!col.field) {
                        const value = [null, row.cedula, row.fullName, row.regional, row.area, row.cargo][c];
                        return (
                          <td key={col.header} className={`${base} px-2 whitespace-nowrap text-secondary ${c === 1 ? "font-mono" : ""}`}>
                            {value}
                          </td>
                        );
                      }
                      const field = col.field;
                      const error = row.errors[field];
                      const inDrag = dragFill.inDrag(r, c);
                      const inRange =
                        range && range.c === c && r >= Math.min(range.r1, range.r2) && r <= Math.max(range.r1, range.r2);
                      const isActive = active?.r === r && active?.c === c;
                      const showHandle = isActive && !drag && canEdit && isFillableColumn(c);
                      const cellState = inDrag
                        ? "bg-primary-surface outline outline-1 outline-dashed outline-primary -outline-offset-1"
                        : inRange && range && range.r1 !== range.r2
                          ? "bg-primary-surface/60"
                          : "";
                      const onCellMouseDown = (e: ReactMouseEvent) => {
                        if (e.shiftKey && active && active.c === c) {
                          e.preventDefault();
                          setRange({ c, r1: active.r, r2: r });
                        }
                      };
                      const onCellFocus = () => {
                        setActive({ r, c });
                        if (!range || range.c !== c || (range.r1 !== r && range.r2 !== r)) setRange({ c, r1: r, r2: r });
                      };
                      const handle = showHandle ? (
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label="Arrastre hacia abajo para copiar el valor (Esc cancela)"
                          title="Arrastre para copiar este valor a otras filas"
                          onMouseDown={(e) => dragFill.start(e, r, c)}
                          className="absolute -bottom-1 -right-1 z-10 w-2.5 h-2.5 bg-primary border border-white cursor-crosshair"
                        />
                      ) : null;
                      if (col.kind === "flag") {
                        const value = row[field] as boolean | null;
                        return (
                          <td
                            key={col.header}
                            className={`${base} text-center relative ${cellState}`}
                            title={field === "isHoliday" && value === null ? "Automático según el calendario de feriados" : error}
                            onMouseDown={onCellMouseDown}
                          >
                            <input
                              type="checkbox"
                              onFocus={onCellFocus}
                              data-r={r}
                              data-c={c}
                              disabled={!canEdit}
                              checked={value === true}
                              aria-label={`${col.header} ${row.fullName}`}
                              onChange={(e) => update(row.key, { [field]: e.target.checked } as Partial<CaptureRow>)}
                              onKeyDown={onCellKeyDown}
                            />
                            {field === "isHoliday" && value === null && <span className="ml-1 text-[10px] text-secondary">auto</span>}
                            {handle}
                          </td>
                        );
                      }
                      return (
                        <td key={col.header} className={`${base} relative ${cellState}`} title={error} onMouseDown={onCellMouseDown}>
                          <input
                            onFocus={(e) => {
                              onCellFocus();
                              if (e.target.type === "text") e.target.select();
                            }}
                            type={col.kind === "date" ? "date" : "text"}
                            inputMode={col.kind === "hours" ? "decimal" : undefined}
                            min={col.kind === "date" ? period.startDate : undefined}
                            max={col.kind === "date" ? period.endDate : undefined}
                            data-r={r}
                            data-c={c}
                            value={row[field] as string}
                            disabled={!canEdit}
                            aria-label={`${col.header} ${row.fullName}`}
                            aria-invalid={Boolean(error)}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (col.kind === "date") {
                                const wd = value ? isoWeekday(value) : -1;
                                update(row.key, { date: value, isSaturday: wd === 6, isSunday: wd === 0, isHoliday: null });
                              } else {
                                update(row.key, { [field]: value } as Partial<CaptureRow>);
                              }
                            }}
                            onKeyDown={onCellKeyDown}
                            onPaste={(e) => onCellPaste(e, r, c)}
                            className={`${cls(field)} ${col.kind === "hours" ? "text-right w-20" : col.kind === "text" ? "min-w-[200px]" : ""}`}
                          />
                          {handle}
                        </td>
                      );
                    })}
                    <td className="border-b border-border px-1 text-center">
                      <button
                        type="button"
                        onClick={() => deleteRow(row)}
                        disabled={!canEdit || deleting !== null}
                        aria-label={`Eliminar fila de ${row.fullName}`}
                        title={
                          !canEdit
                            ? "No se puede eliminar: período cerrado, fila bloqueada o sin permiso."
                            : row.id === null
                              ? "Quitar esta fila (no está guardada)"
                              : "Eliminar este registro guardado (el colaborador sigue en la base)"
                        }
                        className="p-1 rounded text-secondary hover:text-danger hover:bg-danger/10 disabled:opacity-30 disabled:hover:text-secondary disabled:hover:bg-transparent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {errorList.length > 0 && (
        <div className="border border-danger/30 rounded-lg p-3 text-xs space-y-1" role="alert">
          <p className="font-semibold text-danger">Corrija antes de guardar (las demás filas se guardan igual):</p>
          <ul className="max-h-32 overflow-y-auto space-y-0.5">
            {errorList.slice(0, 50).map((e, idx) => (
              <li key={idx}>
                Fila {e.i + 1} · {e.name} · {fieldHeader(e.field)}: {e.msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pickerOpen && (
        <CollaboratorPicker
          team={team}
          date={defaultDate}
          taken={new Set(rows.filter((r) => r.date === defaultDate).map((r) => r.collaboratorId))}
          onClose={() => setPickerOpen(false)}
          onAdd={(ids) => {
            setPickerOpen(false);
            addCollaborators(ids);
          }}
        />
      )}
      {pasteOpen && (
        <PasteDialog
          team={team}
          fallbackDate={defaultDate}
          onClose={() => setPasteOpen(false)}
          onAdd={(newRows, unknown) => {
            setPasteOpen(false);
            setRows((prev) => [...prev, ...newRows]);
            showToast(
              unknown.length
                ? `${newRows.length} fila(s) agregadas. Cédulas que no son de su equipo: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}`
                : `${newRows.length} fila(s) agregadas.`,
              unknown.length ? "warning" : "success",
            );
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          kind="OVERTIME"
          period={month.code}
          periodRange={{ startDate: month.startDate, endDate: month.endDate, label: month.label }}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            loadExisting();
          }}
        />
      )}
      {deleting && (
        <OvertimeDeleteDialog
          record={deleting.target}
          onClose={() => setDeleting(null)}
          onDone={() => {
            dropRow(deleting.key);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function CollaboratorPicker({
  team,
  date,
  taken,
  onClose,
  onAdd,
}: {
  team: CollaboratorRef[];
  date: string;
  taken: Set<number>;
  onClose: () => void;
  onAdd: (ids: number[]) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return team.filter(
      (c) =>
        !needle ||
        c.fullName.toLowerCase().includes(needle) ||
        c.cedula.includes(needle) ||
        c.cargo.toLowerCase().includes(needle) ||
        c.area.toLowerCase().includes(needle),
    );
  }, [team, q]);
  const selectable = visible.filter((c) => !taken.has(c.id));
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={`Agregar colaboradores · ${formatDate(date)}`} onClose={onClose} />
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar nombre, cédula, cargo o área…" className="flex-1 min-w-[240px]" />
          <Button
            size="sm"
            variant="secondary"
            disabled={!selectable.length}
            onClick={() => setPicked(new Set([...picked, ...selectable.map((c) => c.id)]))}
          >
            Seleccionar visibles ({selectable.length})
          </Button>
          <Button size="sm" variant="ghost" disabled={!picked.size} onClick={() => setPicked(new Set())}>
            Limpiar
          </Button>
        </div>
        {picked.size > 0 && (
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {team
              .filter((c) => picked.has(c.id))
              .map((c) => (
                <button key={c.id} onClick={() => toggle(c.id)} className="text-[11px] bg-primary-surface text-primary rounded-full px-2 py-0.5" title="Quitar">
                  {c.fullName} ✕
                </button>
              ))}
          </div>
        )}
        <ul className="max-h-[45vh] overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {visible.length === 0 && <li className="p-4 text-sm text-secondary text-center">Sin resultados en su equipo.</li>}
          {visible.map((c) => {
            const isTaken = taken.has(c.id);
            return (
              <li key={c.id}>
                <label className={`flex items-center gap-3 px-3 py-2 text-sm ${isTaken ? "opacity-50" : "cursor-pointer hover:bg-surface2"}`}>
                  <input type="checkbox" disabled={isTaken} checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="font-mono text-xs w-24">{c.cedula}</span>
                  <span className="flex-1">{c.fullName}</span>
                  {c.supervisorName && <span className="text-xs text-secondary">{c.supervisorName}</span>}
                  <span className="text-xs text-secondary">{c.cargo}</span>
                  {isTaken && <span className="text-[10px] text-secondary">ya en la tabla para esta fecha</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!picked.size || !date} onClick={() => onAdd([...picked])}>
            Agregar {picked.size} fila(s)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PasteDialog({
  team,
  fallbackDate,
  onClose,
  onAdd,
}: {
  team: CollaboratorRef[];
  fallbackDate: string;
  onClose: () => void;
  onAdd: (rows: CaptureRow[], unknown: string[]) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title="Pegar filas desde Excel" onClose={onClose} />
      <div className="p-5 space-y-3">
        <p className="text-sm text-secondary">
          Copie en Excel las filas con las 13 columnas en el orden oficial (FECHA, CEDULA, … OBSERVACIONES) y péguelas
          aquí. La persona se identifica SOLO por la cédula, contra su equipo: nombre, regional, área y cargo se toman de
          la base, no de lo pegado. Las filas se agregan a la tabla para revisarlas antes de guardar.
        </p>
        <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="font-mono text-xs" placeholder="12/10/2026	1712345678	…" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={() => {
              const result = rowsFromPastedTable(text, team, fallbackDate);
              onAdd(result.rows.map((r) => ({ ...r, key: newRowKey() })), result.unknown);
            }}
          >
            Agregar a la tabla
          </Button>
        </div>
      </div>
    </Modal>
  );
}
