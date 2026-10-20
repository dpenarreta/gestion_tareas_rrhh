import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import OvertimeCapture from "@/components/novedades/OvertimeCapture";
import OvertimeFormDialog from "@/components/novedades/OvertimeFormDialog";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";
import type { OvertimeMonth } from "@/components/novedades/types";
import { hourColumnAccess, type OvertimeDayRules } from "@/lib/novedadesAutosave";
import { CAPTURE_COLUMNS, applyPaste, validateRow, type CaptureRow } from "@/lib/novedadesCapture";

// Columnas de horas según los permisos por tipo de día del Supervisor:
// # HORAS EXTRAS ↔ días laborables; # HORAS SABADO ↔ sábados, domingos y
// feriados. Ocultarlas en la captura no las quita del consolidado nacional.

const rules = (allowed: Partial<NonNullable<OvertimeDayRules["allowed"]>>): OvertimeDayRules => ({
  restricted: true,
  allowed: { weekday: false, saturday: false, sunday: false, holiday: false, ...allowed },
  holidays: [],
});
// Configuración real de José Andaluz en la base de desarrollo.
const JOSE = rules({ saturday: true, sunday: true, holiday: true });

describe("hourColumnAccess", () => {
  it("cubre los escenarios pedidos", () => {
    expect(hourColumnAccess(undefined)).toEqual({ overtimeHours: true, saturdayHours: true }); // Asistente/Admin
    expect(hourColumnAccess(rules({ weekday: true, saturday: true, sunday: true, holiday: true }))).toEqual({
      overtimeHours: true,
      saturdayHours: true,
    });
    expect(hourColumnAccess(rules({ saturday: true }))).toEqual({ overtimeHours: false, saturdayHours: true });
    expect(hourColumnAccess(JOSE)).toEqual({ overtimeHours: false, saturdayHours: true });
    expect(hourColumnAccess(rules({ weekday: true }))).toEqual({ overtimeHours: true, saturdayHours: false });
  });
});

const baseRow = (over: Partial<CaptureRow> = {}) =>
  ({
    key: "a",
    id: null,
    version: null,
    collaboratorId: 5,
    cedula: "0102030405",
    fullName: "Ana Pérez",
    regional: "",
    area: "",
    cargo: "",
    date: "2026-10-11",
    overtimeHours: "",
    saturdayHours: "3",
    isSaturday: false,
    isSunday: true,
    isHoliday: null,
    workDone: "",
    observations: "",
    state: "new",
    dirty: true,
    errors: {},
    ...over,
  }) as CaptureRow;

describe("validateRow con columnas no autorizadas", () => {
  const period = { startDate: "2026-10-01", endDate: "2026-10-31" };

  it("rechaza con motivo un valor en la columna no autorizada de una fila nueva", () => {
    const errors = validateRow(baseRow({ overtimeHours: "2" }), period, new Set(), undefined, JOSE);
    expect(errors.overtimeHours).toMatch(/# HORAS EXTRAS no autorizada/);
    expect(validateRow(baseRow(), period, new Set(), undefined, JOSE)).toEqual({});
  });

  it("no bloquea un registro existente por su valor histórico", () => {
    const existing = baseRow({ id: 9, version: 1, overtimeHours: "2" });
    expect(validateRow(existing, period, new Set(), undefined, JOSE).overtimeHours).toBeUndefined();
  });
});

describe("pegado sobre la tabla con una columna oculta", () => {
  it("reparte el bloque entre las columnas visibles", () => {
    const hidden = new Set([CAPTURE_COLUMNS.findIndex((c) => c.field === "overtimeHours")]);
    const start = CAPTURE_COLUMNS.findIndex((c) => c.field === "overtimeHours");
    const result = applyPaste([baseRow({ saturdayHours: "" })], 0, start, [["4", "NO", "SI"]], () => true, hidden);
    expect(result.rows[0]).toMatchObject({ overtimeHours: "", saturdayHours: "4", isSaturday: false, isSunday: true });
  });
});

const month: OvertimeMonth = {
  code: "2026-10",
  label: "Octubre 2026",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  status: "OPEN",
  graceHours: 48,
  deadline: "2026-11-04T05:00:00Z",
  deadlineLabel: "martes 03/11/2026 23:59",
  remainingSeconds: 1000,
  closingSoon: false,
  closedAt: null,
  closedBy: "",
} as unknown as OvertimeMonth;

function ctxWith(dayRules?: OvertimeDayRules) {
  return {
    period: "2026-10",
    supervisorId: 6,
    can: (c: string) => c !== "novedades.corregir_cerrado",
    me: {
      nationalWrite: false,
      isAssistant: !dayRules,
      user: { id: 6, name: "Sup" },
      deadlineRules: {
        today: "2026-10-12",
        canBypassDeadline: false,
        workedDays: { hours: 48, earliestOpenDate: "2026-10-08" },
        overtime: { hours: 48, earliestOpenDate: "2026-10-08" },
      },
      overtimeDayRules: dayRules,
    },
    setDirty: vi.fn(),
    refreshPeriods: vi.fn(),
    refreshOvertimeMonths: vi.fn(),
  } as unknown as ModuleContext;
}

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("captura de Horas extras según permisos", () => {
  it("José: sin # HORAS EXTRAS, con # HORAS SABADO; lo no autorizado no se envía", async () => {
    window.localStorage.setItem(
      "nexo:novedades:pendiente:horas|2026-10|6|6",
      JSON.stringify({
        savedAt: Date.now(),
        value: [
          { ...baseRow({ key: "ok" }), rev: 1 },
          { ...baseRow({ key: "col", collaboratorId: 6, overtimeHours: "2", saturdayHours: "" }), rev: 1 },
        ],
      }),
    );
    const bodies: { rows: { clientKey: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("overtime/bulk")) {
          const body = JSON.parse(String(init?.body));
          bodies.push(body);
          return json(200, {
            summary: { created: 1, updated: 0, unchanged: 0, errors: 0 },
            rows: body.rows.map((r: { clientKey: string }) => ({ clientKey: r.clientKey, status: "created", errors: {}, recordId: 1, version: 1 })),
          });
        }
        return json(200, []);
      }),
    );
    render(
      <ToastProvider>
        <OvertimeCapture ctx={ctxWith(JOSE)} supervisorId={6} month={month} />
      </ToastProvider>,
    );
    expect(await screen.findByRole("columnheader", { name: "# HORAS SABADO" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "# HORAS EXTRAS" })).not.toBeInTheDocument();
    await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 4000 });
    // La fila válida se guarda; la que trae # HORAS EXTRAS queda con su error.
    expect(bodies[0].rows.map((r) => r.clientKey)).toEqual(["ok"]);
  });

  it("el Asistente de Operaciones conserva todas las columnas", async () => {
    // Con una fila en la tabla (sin filas no se dibujan encabezados).
    window.localStorage.setItem(
      "nexo:novedades:pendiente:horas|2026-10|6|6",
      JSON.stringify({ savedAt: Date.now(), value: [{ ...baseRow({ overtimeHours: "1", saturdayHours: "" }), rev: 1 }] }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));
    render(
      <ToastProvider>
        <OvertimeCapture ctx={ctxWith(undefined)} supervisorId={6} month={month} />
      </ToastProvider>,
    );
    for (const header of ["# HORAS EXTRAS", "# HORAS SABADO", "SABADO", "DOMINGO", "FERIADO", "OBSERVACIONES"]) {
      expect(await screen.findByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  it("el formulario individual oculta la columna no autorizada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));
    render(
      <ToastProvider>
        <OvertimeFormDialog ctx={ctxWith(rules({ saturday: true }))} record={null} onClose={() => undefined} onSaved={() => undefined} />
      </ToastProvider>,
    );
    expect(await screen.findByText("# Horas sábado")).toBeInTheDocument();
    expect(screen.queryByText("# Horas extras")).not.toBeInTheDocument();
  });
});
