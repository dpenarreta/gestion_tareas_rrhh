import { describe, expect, it } from "vitest";
import {
  applyPaste,
  duplicateKeysOf,
  parseDateText,
  parseFlag,
  rowFromCollaborator,
  rowsFromPastedTable,
  summarize,
  validateRow,
  type CollaboratorRef,
} from "@/lib/novedadesCapture";

const PERIOD = { startDate: "2026-09-23", endDate: "2026-10-22" };
const TEAM: CollaboratorRef[] = [
  { id: 1, cedula: "0102030405", fullName: "Ana", regional: "Sierra", area: "Bodega", cargo: "Operador" },
  { id: 2, cedula: "0911111111", fullName: "Beto", regional: "Costa", area: "Rutas", cargo: "Mensajero" },
];

describe("captura masiva de horas extras", () => {
  it("crea una fila por colaborador con la fecha general y la identidad de la base", () => {
    const row = rowFromCollaborator(TEAM[0], "2026-10-10");
    expect(row).toMatchObject({ collaboratorId: 1, cedula: "0102030405", date: "2026-10-10", state: "new", dirty: true });
    // Sábado: se sugiere la marca; feriado queda automático (lo resuelve el servidor).
    expect(row.isSaturday).toBe(true);
    expect(row.isSunday).toBe(false);
    expect(row.isHoliday).toBeNull();
  });

  it("valida números, rango, fecha del período y exige horas", () => {
    const base = rowFromCollaborator(TEAM[0], "2026-10-12");
    expect(validateRow({ ...base, overtimeHours: "2" }, PERIOD, new Set())).toEqual({});
    expect(validateRow({ ...base, overtimeHours: "-1" }, PERIOD, new Set())).toHaveProperty("overtimeHours");
    expect(validateRow({ ...base, overtimeHours: "abc" }, PERIOD, new Set())).toHaveProperty("overtimeHours");
    expect(validateRow({ ...base, saturdayHours: "25" }, PERIOD, new Set())).toHaveProperty("saturdayHours");
    expect(validateRow({ ...base, overtimeHours: "1.555" }, PERIOD, new Set())).toHaveProperty("overtimeHours");
    expect(validateRow(base, PERIOD, new Set())).toHaveProperty("overtimeHours"); // sin horas
    expect(validateRow({ ...base, date: "2026-10-25", overtimeHours: "1" }, PERIOD, new Set())).toHaveProperty("date");
  });

  it("detecta la misma persona y fecha repetida en la tabla", () => {
    const a = { ...rowFromCollaborator(TEAM[0], "2026-10-12"), overtimeHours: "1" };
    const b = { ...rowFromCollaborator(TEAM[0], "2026-10-12"), overtimeHours: "2" };
    const c = { ...rowFromCollaborator(TEAM[1], "2026-10-12"), overtimeHours: "2" };
    const dups = duplicateKeysOf([a, b, c]);
    expect(dups).toEqual(new Set(["1|2026-10-12"]));
    expect(validateRow(a, PERIOD, dups)).toHaveProperty("date");
    expect(summarize([a, b, c], dups).duplicates).toBe(2);
  });

  it("pega un rango desde Excel solo en columnas editables", () => {
    const rows = [rowFromCollaborator(TEAM[0], "2026-10-12"), rowFromCollaborator(TEAM[1], "2026-10-12")];
    // Desde "# HORAS EXTRAS" (columna 6): horas extras, horas sábado, SABADO.
    const result = applyPaste(rows, 0, 6, [["2", "1", "SI"], ["3,5", "", "no"], ["9", "9", "9"]], () => true);
    expect(result.rows[0]).toMatchObject({ overtimeHours: "2", saturdayHours: "1", isSaturday: true });
    expect(result.rows[1]).toMatchObject({ overtimeHours: "3.5", saturdayHours: "", isSaturday: false });
    expect(result.skippedRows).toBe(1);
    // Pegar sobre CEDULA/NOMBRE no cambia la identidad.
    const id = applyPaste(rows, 0, 1, [["9999999999", "Otra persona"]], () => true);
    expect(id.rows[0]).toMatchObject({ cedula: "0102030405", fullName: "Ana" });
  });

  it("filas completas pegadas se resuelven por cédula contra el equipo", () => {
    const text = [
      "FECHA\tCEDULA\tNOMBRE DEL COLABORADOR",
      "12/10/2026\t0102030405\tNombre falso\tX\tX\tX\t2\t0\tNO\tNO\tNO\tCarga\tObs",
      "12/10/2026\t0999999999\tAjeno\t\t\t\t1",
    ].join("\n");
    const { rows, unknown } = rowsFromPastedTable(text, TEAM, "2026-10-13");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fullName: "Ana", date: "2026-10-12", overtimeHours: "2", workDone: "Carga" });
    expect(unknown).toEqual(["0999999999"]);
  });

  it("interpreta marcas y fechas de Excel", () => {
    expect(parseFlag("Sí")).toBe(true);
    expect(parseFlag("x")).toBe(true);
    expect(parseFlag("")).toBe(false);
    expect(parseFlag("tal vez")).toBeNull();
    expect(parseDateText("3/10/2026")).toBe("2026-10-03");
    expect(parseDateText("2026-10-03")).toBe("2026-10-03");
    expect(parseDateText("octubre")).toBeNull();
  });

  it("resume nuevas, modificadas, válidas y con error", () => {
    const valid = { ...rowFromCollaborator(TEAM[0], "2026-10-12"), overtimeHours: "1" };
    const invalid = { ...rowFromCollaborator(TEAM[1], "2026-10-12"), errors: { overtimeHours: "x" } };
    const modified = { ...valid, key: "r9", id: 9, collaboratorId: 3, date: "2026-10-13" };
    const locked = { ...valid, key: "r10", id: 10, collaboratorId: 4, state: "locked" as const };
    expect(summarize([valid, invalid, modified, locked], new Set())).toEqual({
      newRows: 2,
      modified: 1,
      valid: 2,
      withErrors: 1,
      duplicates: 0,
      locked: 1,
    });
  });
});
