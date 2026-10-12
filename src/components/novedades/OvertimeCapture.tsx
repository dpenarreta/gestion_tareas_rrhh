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
import { ArrowDownToLine, ClipboardPaste, Download, FileSpreadsheet, Plus, RotateCw, Save, Trash2, Upload } from "lucide-react";
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
import { PERM, type OvertimeRecord, type PeriodOption } from "./types";
import type { ModuleContext } from "./NovedadesModule";
import ImportDialog from "./ImportDialog";

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

export default function OvertimeCapture({ ctx, supervisorId }: { ctx: ModuleContext; supervisorId: number }) {
  const { showToast } = useToast();
  const [period, setPeriod] = useState<PeriodOption | null>(null);
  const [team, setTeam] = useState<CollaboratorRef[]>([]);
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const [defaultDate, setDefaultDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Celda activa y rango vertical (una columna) para el relleno tipo Excel.
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [range, setRange] = useState<{ c: number; r1: number; r2: number } | null>(null);
  const [drag, setDrag] = useState<{ c: number; from: number; to: number } | null>(null);
  const dragRef = useRef<{ c: number; from: number; to: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const canWrite = ctx.can(PERM.registrar) && !ctx.me.isAssistant;
  const isOpen = period?.status === "OPEN";
  const editable = useCallback((row: CaptureRow) => Boolean(canWrite && isOpen && row.state !== "locked"), [canWrite, isOpen]);

  // Período y equipo del supervisor: se cargan una vez por período/equipo.
  useEffect(() => {
    novedadesApi.get<PeriodOption[]>("periods", { supervisor: supervisorId }).then((r) => {
      if (!r.ok) return;
      const p = r.data.find((x) => x.code === ctx.period) ?? null;
      setPeriod(p);
      if (p) {
        const today = new Date().toISOString().slice(0, 10);
        setDefaultDate(today >= p.startDate && today <= p.endDate ? today : p.startDate);
      }
    });
    novedadesApi
      .get<CollaboratorRef[]>("collaborators", { status: "ACTIVE", supervisor: supervisorId })
      .then((r) => r.ok && setTeam(r.data));
  }, [ctx.period, supervisorId]);

  const dupKeys = useMemo(() => duplicateKeysOf(rows), [rows]);
  // Validación en vivo (ayuda): solo para filas con cambios pendientes.
  const validated = useMemo(
    () =>
      rows.map((r) => {
        if (!period || !r.dirty || r.state === "locked") return r;
        const local = validateRow(r, period, dupKeys);
        const server = r.state === "error" ? r.errors : {};
        return { ...r, errors: { ...server, ...local } };
      }),
    [rows, period, dupKeys],
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
      period: ctx.period,
      supervisor: supervisorId,
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

  function startDrag(e: ReactMouseEvent, r: number, c: number) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { c, from: r, to: r };
    setDrag(dragRef.current);
    const onMove = (ev: MouseEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-row]");
      if (!el || !dragRef.current) return;
      const to = Number(el.dataset.row);
      if (to !== dragRef.current.to) {
        dragRef.current = { ...dragRef.current, to };
        setDrag(dragRef.current);
      }
    };
    const finish = (apply: boolean) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (apply && current && current.to !== current.from) {
        const targets = rangeRows({ r1: current.from, r2: current.to }).filter((i) => i !== current.from);
        fill(current.c, current.from, targets);
        setRange({ c: current.c, r1: current.from, r2: current.to });
      }
    };
    const onUp = () => finish(true);
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") finish(false); // cancela el arrastre sin aplicar
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
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

  async function save() {
    setConfirmOpen(false);
    setSaveError(null);
    const toSend = validated.filter((r) => r.dirty && r.state !== "locked" && Object.keys(r.errors).length === 0);
    if (!toSend.length) return;
    const results = new Map<string, RowResult>();
    for (let start = 0; start < toSend.length; start += BATCH) {
      const chunk = toSend.slice(start, start + BATCH);
      setSaving(toSend.length > BATCH ? `Guardando ${Math.min(start + BATCH, toSend.length)} de ${toSend.length}…` : "Guardando…");
      const response = await novedadesApi.post<BulkResponse>("overtime/bulk", {
        period: ctx.period,
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
        // Nada se borra: las filas quedan en la tabla y el reintento no
        // duplica (el servidor reconoce lo que ya guardó).
        setSaving(null);
        setSaveError(`${response.error} Los datos siguen en la tabla: puede reintentar sin riesgo de duplicar.`);
        applyResults(results);
        return;
      }
      response.data.rows.forEach((r) => results.set(r.clientKey, r));
    }
    setSaving(null);
    applyResults(results);
    const values = [...results.values()];
    const ok = values.filter((r) => ["created", "updated", "unchanged"].includes(r.status)).length;
    const failed = values.length - ok;
    showToast(
      failed ? `Guardado parcial: ${ok} fila(s) guardadas, ${failed} requieren corrección.` : `Guardado: ${ok} fila(s).`,
      failed ? "warning" : "success",
    );
  }

  function applyResults(results: Map<string, RowResult>) {
    if (!results.size) return;
    setRows((prev) =>
      prev.map((r) => {
        const res = results.get(r.key);
        if (!res) return r;
        if (["created", "updated", "unchanged"].includes(res.status)) {
          return { ...r, id: res.recordId ?? r.id, version: res.version ?? r.version, state: "saved", dirty: false, errors: {} };
        }
        return { ...r, state: res.status === "locked" ? "locked" : "error", errors: res.errors as CaptureRow["errors"] };
      }),
    );
  }

  if (!period) return <p className="text-sm text-secondary py-6">Cargando período…</p>;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const errorList = validated.flatMap((r, i) =>
    Object.entries(r.errors).map(([field, msg]) => ({ i, name: r.fullName, field, msg })),
  );
  const fieldHeader = (field: string) => CAPTURE_COLUMNS.find((c) => c.field === field)?.header ?? (field === "row" ? "Fila" : "Colaborador");

  return (
    <div className="space-y-3">
      {!isOpen && (
        <ErrorBox message={`${period.label} está cerrado para este equipo: la captura ordinaria está bloqueada.`} />
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
          <Button
            size="sm"
            variant="ghost"
            disabled={!pendingCount || Boolean(saving)}
            onClick={() => {
              if (window.confirm("¿Descartar todos los cambios sin guardar? Las filas con cambios se quitan de la tabla.")) {
                setRows((prev) => prev.filter((r) => !r.dirty));
              }
            }}
          >
            Descartar
          </Button>
          <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={!summary.valid || Boolean(saving)} loading={Boolean(saving)}>
            <Save className="w-4 h-4" /> {saving ?? `Guardar ${summary.valid} fila(s)`}
          </Button>
        </div>
      </div>
      <ErrorBox message={saveError} />
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
                      const inDrag =
                        drag && drag.c === c && r >= Math.min(drag.from, drag.to) && r <= Math.max(drag.from, drag.to);
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
                          onMouseDown={(e) => startDrag(e, r, c)}
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
          period={ctx.period}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            loadExisting();
          }}
        />
      )}
      {confirmOpen && (
        <Modal open onClose={() => setConfirmOpen(false)} size="sm">
          <ModalHeader title="Guardar lote de horas extras" onClose={() => setConfirmOpen(false)} />
          <div className="p-5 space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-y-1 bg-surface2 rounded-lg p-3">
              <dt className="text-secondary">Filas nuevas</dt>
              <dd className="text-right font-semibold">{summary.newRows}</dd>
              <dt className="text-secondary">Filas modificadas</dt>
              <dd className="text-right font-semibold">{summary.modified}</dd>
              <dt className="text-secondary">Se enviarán (válidas)</dt>
              <dd className="text-right font-semibold">{summary.valid}</dd>
              <dt className="text-secondary">Con errores (no se envían)</dt>
              <dd className="text-right font-semibold">{summary.withErrors}</dd>
              <dt className="text-secondary">Posibles duplicados</dt>
              <dd className="text-right font-semibold">{summary.duplicates}</dd>
              <dt className="text-secondary">Bloqueadas</dt>
              <dd className="text-right font-semibold">{summary.locked}</dd>
            </dl>
            <p className="text-xs text-secondary">
              El servidor vuelve a validar cada fila. Las que no pasen quedan marcadas en la tabla, con su motivo, sin
              perder lo escrito.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={save}>Guardar {summary.valid} fila(s)</Button>
            </div>
          </div>
        </Modal>
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
