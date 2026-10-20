import {
  HOUR_COLUMN_DENIED,
  deadlineError,
  hourColumnAccess,
  overtimeDayError,
  type DeadlineRules,
  type OvertimeDayRules,
} from "@/lib/novedadesAutosave";
// Lógica pura de la captura masiva de Horas extras (Control Operativo de
// Novedades). La validación de acá es una AYUDA para que la persona corrija
// antes de guardar; la autoridad es Django (`OvertimeService.bulk_save`), que
// vuelve a validar cada fila y nunca confía en la identidad que manda el
// navegador.

export type CaptureState = "new" | "existing" | "saved" | "error" | "locked";

export type CaptureRow = {
  key: string;
  id: number | null;
  version: number | null;
  collaboratorId: number;
  cedula: string;
  fullName: string;
  regional: string;
  area: string;
  cargo: string;
  date: string;
  overtimeHours: string;
  saturdayHours: string;
  isSaturday: boolean;
  isSunday: boolean;
  /** `null` = automático: Django lo marca si la fecha está en el
   * calendario de feriados (Ajustes → Feriados), que el navegador no conoce. */
  isHoliday: boolean | null;
  workDone: string;
  observations: string;
  state: CaptureState;
  dirty: boolean;
  /** Revisión local: sube con cada edición. Una respuesta del servidor solo
   * marca la fila como guardada si corresponde a la revisión enviada. */
  rev?: number;
  errors: Partial<Record<CaptureField | "row" | "collaborator", string>>;
};

export type CaptureField =
  | "date"
  | "overtimeHours"
  | "saturdayHours"
  | "isSaturday"
  | "isSunday"
  | "isHoliday"
  | "workDone"
  | "observations";

export type CollaboratorRef = {
  id: number;
  cedula: string;
  fullName: string;
  regional: string;
  area: string;
  cargo: string;
  /** Equipo del colaborador (se muestra en la vista "Todos los supervisores"). */
  supervisorName?: string;
};

// Orden EXACTO de las 13 columnas visibles; `null` = solo lectura (identidad
// que sale de la base). Se usa también para mapear un pegado desde Excel.
export const CAPTURE_COLUMNS: { header: string; field: CaptureField | null; kind: "date" | "hours" | "flag" | "text" | "ro" }[] = [
  { header: "FECHA", field: "date", kind: "date" },
  { header: "CEDULA", field: null, kind: "ro" },
  { header: "NOMBRE DEL COLABORADOR", field: null, kind: "ro" },
  { header: "REGIONAL", field: null, kind: "ro" },
  { header: "ÁREA", field: null, kind: "ro" },
  { header: "CARGO", field: null, kind: "ro" },
  { header: "# HORAS EXTRAS", field: "overtimeHours", kind: "hours" },
  { header: "# HORAS SABADO", field: "saturdayHours", kind: "hours" },
  { header: "SABADO", field: "isSaturday", kind: "flag" },
  { header: "DOMINGO", field: "isSunday", kind: "flag" },
  { header: "FERIADO", field: "isHoliday", kind: "flag" },
  { header: "TRABAJO REALIZADO", field: "workDone", kind: "text" },
  { header: "OBSERVACIONES", field: "observations", kind: "text" },
];

const HOURS_RE = /^\d{1,2}([.,]\d{1,2})?$/;
let keySeq = 0;

export function newRowKey(): string {
  keySeq += 1;
  return `n${Date.now().toString(36)}${keySeq}`;
}

/** Día de la semana de una fecha ISO sin pasar por zonas horarias. */
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function rowFromCollaborator(c: CollaboratorRef, date: string): CaptureRow {
  const weekday = date ? isoWeekday(date) : -1;
  return {
    key: newRowKey(),
    id: null,
    version: null,
    collaboratorId: c.id,
    cedula: c.cedula,
    fullName: c.fullName,
    regional: c.regional,
    area: c.area,
    cargo: c.cargo,
    date,
    overtimeHours: "",
    saturdayHours: "",
    isSaturday: weekday === 6,
    isSunday: weekday === 0,
    isHoliday: null,
    workDone: "",
    observations: "",
    state: "new",
    dirty: true,
    errors: {},
  };
}

function hoursError(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  if (!HOURS_RE.test(value.trim())) return "Número válido, hasta 2 decimales (ej. 2 o 1.5).";
  if (Number(value.replace(",", ".")) > 24) return "No puede superar 24 horas.";
  return undefined;
}

/** Errores de una fila por campo (vacío = válida), incluido el chequeo de
 * duplicados de persona+fecha dentro de la misma tabla. */
export function validateRow(
  row: CaptureRow,
  period: { startDate: string; endDate: string },
  duplicateKeys: Set<string>,
  deadline?: DeadlineRules,
  dayRules?: OvertimeDayRules,
): CaptureRow["errors"] {
  const errors: CaptureRow["errors"] = {};
  const late = deadlineError(row.date, deadline, "overtime");
  const dayDenied = overtimeDayError(row.date, row.regional, dayRules);
  if (!row.date) errors.date = "La fecha es obligatoria.";
  else if (row.date < period.startDate || row.date > period.endDate) errors.date = "Fuera del período seleccionado.";
  else if (late) errors.date = late;
  else if (dayDenied) errors.date = dayDenied;
  else if (duplicateKeys.has(`${row.collaboratorId}|${row.date}`)) errors.date = "Persona y fecha repetidas en la tabla.";
  const oe = hoursError(row.overtimeHours);
  const se = hoursError(row.saturdayHours);
  if (oe) errors.overtimeHours = oe;
  if (se) errors.saturdayHours = se;
  // Columna no autorizada con datos (llegados por pegado o respaldo local):
  // se rechaza con su motivo, nunca se descarta en silencio. Solo en filas
  // nuevas: lo ya registrado se conserva aunque el permiso cambie después.
  if (row.id === null) {
    const access = hourColumnAccess(dayRules);
    for (const field of ["overtimeHours", "saturdayHours"] as const) {
      if (!access[field] && row[field].trim() !== "" && Number(row[field].replace(",", ".")) !== 0) {
        errors[field] = HOUR_COLUMN_DENIED[field];
      }
    }
  }
  if (!oe && !se) {
    const total = Number(row.overtimeHours.replace(",", ".") || 0) + Number(row.saturdayHours.replace(",", ".") || 0);
    if (total <= 0) errors.overtimeHours = "Registre horas extras o de sábado.";
  }
  if (row.workDone.length > 500) errors.workDone = "Máximo 500 caracteres.";
  if (row.observations.length > 1000) errors.observations = "Máximo 1000 caracteres.";
  return errors;
}

/** Claves persona|fecha que aparecen más de una vez en la tabla. */
export function duplicateKeysOf(rows: CaptureRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    const k = `${r.collaboratorId}|${r.date}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
}

export function parseFlag(value: string): boolean | null {
  const v = value.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["SI", "S", "X", "1", "TRUE", "VERDADERO"].includes(v)) return true;
  if (["", "NO", "N", "0", "FALSE", "FALSO"].includes(v)) return false;
  return null;
}

/** dd/mm/aaaa, d/m/aaaa o aaaa-mm-dd → aaaa-mm-dd (o null). */
export function parseDateText(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  let parts: [number, number, number] | null = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  if (!parts) {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (m) parts = [Number(m[3]), Number(m[2]), Number(m[1])];
  }
  if (!parts) return null;
  const [y, mo, d] = parts;
  // Solo fechas que existen: un "10/17/2026" (mes/día) no es una fecha en
  // dd/mm/aaaa; antes se convertía en "2026-17-10", que comparado como texto
  // parecía una fecha futura y bloqueaba la fila con un motivo equivocado.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Texto tabulado del portapapeles (Excel) → matriz de celdas. */
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/** Aplica un bloque pegado sobre la tabla a partir de (fila, columna),
 * solo en columnas editables; las de identidad se ignoran. Devuelve las
 * filas nuevas y cuántos valores no se pudieron interpretar. */
export function applyPaste(
  rows: CaptureRow[],
  startRow: number,
  startCol: number,
  block: string[][],
  editable: (row: CaptureRow) => boolean,
  hiddenColumns: ReadonlySet<number> = new Set(),
): { rows: CaptureRow[]; invalid: number; skippedRows: number } {
  const next = rows.map((r) => ({ ...r }));
  // Pegado sobre la tabla: cada valor va a la siguiente columna visible (la
  // que ve quien pega), no a una oculta por permisos.
  const targets = CAPTURE_COLUMNS.map((_, i) => i).filter((i) => i >= startCol && !hiddenColumns.has(i));
  let invalid = 0;
  let skippedRows = 0;
  block.forEach((cells, i) => {
    const row = next[startRow + i];
    if (!row) {
      skippedRows += 1;
      return;
    }
    if (!editable(row)) return;
    cells.forEach((raw, j) => {
      const column = CAPTURE_COLUMNS[targets[j] ?? -1];
      if (!column?.field) return;
      const value = raw.trim();
      if (column.kind === "flag") {
        const flag = parseFlag(value);
        if (flag === null) invalid += 1;
        else (row[column.field] as boolean) = flag;
      } else if (column.kind === "date") {
        const iso = parseDateText(value);
        if (iso === null) invalid += 1;
        else row.date = iso;
      } else {
        (row[column.field] as string) = column.kind === "hours" ? value.replace(",", ".") : value;
      }
      row.dirty = true;
    });
  });
  return { rows: next, invalid, skippedRows };
}

/** Filas completas pegadas desde Excel (13 columnas en el orden oficial):
 * resuelve cada cédula contra el equipo cargado, nunca contra lo pegado. */
export function rowsFromPastedTable(
  text: string,
  team: CollaboratorRef[],
  fallbackDate: string,
): { rows: CaptureRow[]; unknown: string[]; invalidDates: string[] } {
  const byCedula = new Map(team.map((c) => [c.cedula, c]));
  const rows: CaptureRow[] = [];
  const unknown: string[] = [];
  const invalidDates: string[] = [];
  for (const cells of parseClipboard(text)) {
    if (cells.length < 2 || /CEDULA/i.test(cells[1] ?? "")) continue;
    const cedula = (cells[1] ?? "").trim().replace(/[\s-]/g, "");
    const collaborator = byCedula.get(cedula);
    if (!collaborator) {
      if (cedula) unknown.push(cedula);
      continue;
    }
    const rawDate = (cells[0] ?? "").trim();
    const date = rawDate ? parseDateText(rawDate) : fallbackDate;
    if (date === null) {
      invalidDates.push(rawDate);
      continue;
    }
    const row = rowFromCollaborator(collaborator, date);
    const pasted = applyPaste([row], 0, 0, [cells], () => true);
    rows.push(pasted.rows[0]);
  }
  return { rows, unknown, invalidDates };
}

export type CaptureSummary = {
  newRows: number;
  modified: number;
  valid: number;
  withErrors: number;
  duplicates: number;
  locked: number;
};

export function summarize(rows: CaptureRow[], duplicateKeys: Set<string>): CaptureSummary {
  const pending = rows.filter((r) => r.dirty && r.state !== "locked");
  return {
    newRows: pending.filter((r) => r.id === null).length,
    modified: pending.filter((r) => r.id !== null).length,
    valid: pending.filter((r) => Object.keys(r.errors).length === 0).length,
    withErrors: pending.filter((r) => Object.keys(r.errors).length > 0).length,
    duplicates: rows.filter((r) => r.date && duplicateKeys.has(`${r.collaboratorId}|${r.date}`)).length,
    locked: rows.filter((r) => r.state === "locked").length,
  };
}

// ── Relleno tipo Excel ────────────────────────────────────────────────────────

/** Columnas que admiten relleno: solo valores capturados. FECHA tiene su
 * propia acción explícita ("Aplicar fecha a seleccionadas") y la identidad
 * del colaborador nunca se rellena. */
export const FILLABLE_KINDS = new Set(["hours", "flag", "text"]);

export function isFillableColumn(colIndex: number): boolean {
  const column = CAPTURE_COLUMNS[colIndex];
  return Boolean(column?.field && FILLABLE_KINDS.has(column.kind));
}

/** Copia el valor de la celda origen (misma columna) en las filas destino.
 * Siempre COPIA — un 2 rellena 2, 2, 2; nunca genera una serie 3, 4, 5.
 * Las filas no editables (bloqueadas, período cerrado) se saltan y se
 * informan; las que ya tienen ese mismo valor no se marcan como cambiadas. */
export function fillColumn(
  rows: CaptureRow[],
  colIndex: number,
  sourceIndex: number,
  targetIndexes: number[],
  editable: (row: CaptureRow) => boolean,
): { rows: CaptureRow[]; filled: number; skipped: number } {
  const field = CAPTURE_COLUMNS[colIndex]?.field;
  const source = rows[sourceIndex];
  if (!field || !source || !isFillableColumn(colIndex)) return { rows, filled: 0, skipped: 0 };
  const value = source[field];
  let filled = 0;
  let skipped = 0;
  const targets = new Set(targetIndexes.filter((i) => i !== sourceIndex));
  const next = rows.map((row, i) => {
    if (!targets.has(i)) return row;
    if (!editable(row)) {
      skipped += 1;
      return row;
    }
    if (row[field] === value) return row;
    filled += 1;
    return {
      ...row,
      [field]: value,
      dirty: true,
      errors: {},
      state: row.id === null ? ("new" as const) : ("existing" as const),
    };
  });
  return { rows: next, filled, skipped };
}

/** Celdas de un rango (misma columna) como texto tabulado, para Ctrl+C. */
export function copyColumnRange(rows: CaptureRow[], colIndex: number, from: number, to: number): string {
  const field = CAPTURE_COLUMNS[colIndex]?.field;
  const column = CAPTURE_COLUMNS[colIndex];
  const [a, b] = from <= to ? [from, to] : [to, from];
  return rows
    .slice(a, b + 1)
    .map((row) => {
      if (!field) {
        return [null, row.cedula, row.fullName, row.regional, row.area, row.cargo][colIndex] ?? "";
      }
      const value = row[field];
      if (column.kind === "flag") return value === true ? "SI" : value === false ? "NO" : "";
      if (column.kind === "date") return row.date ? row.date.split("-").reverse().join("/") : "";
      return String(value ?? "");
    })
    .join("\n");
}
