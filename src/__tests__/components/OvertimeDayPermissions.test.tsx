import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { overtimeDayError, type OvertimeDayRules } from "@/lib/novedadesAutosave";
import { validateRow, type CaptureRow } from "@/lib/novedadesCapture";
import { ToastProvider } from "@/components/ui/Toast";
import OvertimeDayPermissionsSection from "@/components/settings/OvertimeDayPermissionsSection";

// Permisos por tipo de día del Supervisor en Horas extras: la pantalla avisa
// con la misma regla que Django revalida (ver backend
// `OvertimeDayPermissionService`).

const rules = (allowed: Partial<OvertimeDayRules["allowed"]> = {}): OvertimeDayRules => ({
  restricted: true,
  allowed: { weekday: false, saturday: false, sunday: false, holiday: false, ...allowed },
  holidays: [
    { date: "2026-10-09", regional: "" }, // viernes nacional
    { date: "2026-10-10", regional: "" }, // sábado nacional
    { date: "2026-10-08", regional: "costa" }, // jueves local
  ],
});

describe("overtimeDayError", () => {
  it("no restringe a quien no es Supervisor (Asistente, Administrador)", () => {
    expect(overtimeDayError("2026-10-11", "", { restricted: false, allowed: null, holidays: [] })).toBeNull();
  });

  it("distingue laborable, sábado y domingo", () => {
    const r = rules({ weekday: true });
    expect(overtimeDayError("2026-10-12", "Sierra", r)).toBeNull();
    expect(overtimeDayError("2026-10-11", "Sierra", r)).toMatch(/domingos \(11\/10\/2026\)/);
  });

  it("un feriado entre semana exige solo el de feriado; en sábado, ambos", () => {
    expect(overtimeDayError("2026-10-09", "", rules({ weekday: true }))).toMatch(/feriados/);
    expect(overtimeDayError("2026-10-09", "", rules({ holiday: true }))).toBeNull();
    expect(overtimeDayError("2026-10-10", "", rules({ holiday: true }))).toMatch(/sábados/);
    expect(overtimeDayError("2026-10-10", "", rules({ saturday: true }))).toMatch(/feriados/);
    expect(overtimeDayError("2026-10-10", "", rules({ saturday: true, holiday: true }))).toBeNull();
  });

  it("el feriado local solo cuenta para su regional", () => {
    const r = rules({ weekday: true });
    expect(overtimeDayError("2026-10-08", "Sierra", r)).toBeNull();
    expect(overtimeDayError("2026-10-08", " Costa ", r)).toMatch(/feriados/);
  });

  it("validateRow marca la fecha no autorizada en la captura masiva", () => {
    const row = {
      key: "a",
      id: null,
      version: null,
      collaboratorId: 1,
      cedula: "0102030405",
      fullName: "Ana",
      regional: "Sierra",
      area: "",
      cargo: "",
      date: "2026-10-11",
      overtimeHours: "2",
      saturdayHours: "",
      isSaturday: false,
      isSunday: true,
      isHoliday: null,
      workDone: "",
      observations: "",
      state: "new",
      dirty: true,
      errors: {},
    } as unknown as CaptureRow;
    const period = { startDate: "2026-10-01", endDate: "2026-10-31" };
    expect(validateRow(row, period, new Set(), undefined, rules({ weekday: true })).date).toMatch(/domingos/);
    expect(validateRow(row, period, new Set(), undefined, rules({ sunday: true })).date).toBeUndefined();
  });
});

describe("Matriz de permisos por tipo de día", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("muestra cada supervisor y guarda un tipo de día por separado", async () => {
    const patches: { url: string; body: unknown }[] = [];
    const base = {
      supervisor: { id: 7, name: "Carla Supervisora", isActive: true },
      permissions: { weekday: true, saturday: false, sunday: false, holiday: false },
      configured: false,
      updatedBy: "",
      updatedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          patches.push({ url, body });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ...base, configured: true, permissions: { ...base.permissions, ...body }, updatedBy: "Admin" }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [base] } as Response;
      }),
    );
    render(
      <ToastProvider>
        <OvertimeDayPermissionsSection />
      </ToastProvider>,
    );
    // La sección arranca colapsada: se abre por su título.
    fireEvent.click(screen.getByText("Horas extras por tipo de día — Supervisores"));
    expect(await screen.findByText("Carla Supervisora")).toBeInTheDocument();
    expect(screen.getByText("Sin configurar")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Domingos — Carla Supervisora"), { target: { value: "1" } });
    await waitFor(() => expect(patches).toEqual([{ url: "/api/novedades/permissions/overtime-days/7", body: { sunday: true } }]));
    expect(await screen.findByText(/Admin/)).toBeInTheDocument();
  });
});
