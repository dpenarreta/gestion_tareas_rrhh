import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import WorkedDaysGrid from "@/components/novedades/WorkedDaysGrid";
import OvertimeView from "@/components/novedades/OvertimeView";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";
import type { OvertimeMonth, WorkedDaysMatrix } from "@/components/novedades/types";

// Vista "Todos los supervisores" del Asistente de Operaciones: se ve y se
// trabaja sin elegir un supervisor (ver docs/CHANGELOG.md § v1.174.1).

const rules = {
  today: "2026-10-12",
  canBypassDeadline: true,
  workedDays: { hours: 48, earliestOpenDate: "2026-10-08" },
  overtime: { hours: 48, earliestOpenDate: "2026-10-08" },
};

const month: OvertimeMonth = {
  code: "2026-10", label: "Octubre 2026", startDate: "2026-10-01", endDate: "2026-10-31", status: "OPEN",
  graceHours: 48, deadline: "2026-11-04T05:00:00Z", deadlineLabel: "martes 03/11/2026 23:59",
  remainingSeconds: 1000, closingSoon: false, closedAt: null, closedBy: "", supervisorsClosed: 0, supervisorsTotal: 2,
};

const ctx = {
  period: "2026-10",
  overtimeMonth: "2026-10",
  overtimeMonths: [month],
  refreshOvertimeMonths: vi.fn(),
  supervisorId: null,
  can: (c: string) => !["novedades.corregir_cerrado", "novedades.importar", "novedades.cerrar_periodo"].includes(c),
  me: { nationalWrite: false, nationalRead: true, isAssistant: true, user: { id: 9, name: "Asis" }, deadlineRules: rules },
  setDirty: vi.fn(),
  refreshPeriods: vi.fn(),
} as unknown as ModuleContext;

function consolidated(): WorkedDaysMatrix {
  const row = (id: number, name: string, team: number, teamName: string) => ({
    collaboratorId: id, cedula: `01020304${id}`, fullName: name, cargo: "", area: "", regional: "",
    status: "ACTIVE", isCurrentMember: true, cells: {}, totalHours: "0",
    supervisorId: team, supervisorName: teamName, editable: true, periodStatus: "OPEN",
  });
  return {
    period: { code: "2026-10", label: "Octubre 2026", startDate: "2026-09-23", endDate: "2026-10-22", status: "OPEN", closedAt: null, closedBy: "" },
    supervisor: null,
    editable: true,
    closable: false,
    supervisorsTotal: 2,
    supervisorsClosed: 0,
    columns: [{ date: "2026-10-09", day: 9, weekday: "Viernes", isWeekend: false, holiday: "", deadlineState: "", deadlineLabel: "" }],
    rows: [row(51, "Ana Pérez", 6, "Sup Norte"), row(52, "Beto Ruiz", 7, "Sup Sur")],
  } as unknown as WorkedDaysMatrix;
}

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("Días laborados — Todos los supervisores", () => {
  it("carga todos los equipos sin elegir y guarda cada fila en su equipo", async () => {
    const urls: string[] = [];
    const posts: { supervisorId: number; cells: { collaboratorId: number }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(String(url));
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return json(200, { saved: 1 });
        }
        return json(200, consolidated());
      }),
    );
    render(
      <ToastProvider>
        <WorkedDaysGrid ctx={ctx} supervisorId={null} />
      </ToastProvider>,
    );
    expect(await screen.findByText("Todos los supervisores")).toBeInTheDocument();
    expect(screen.getByText(/0\/2 supervisores cerraron/)).toBeInTheDocument();
    expect(urls[0]).not.toContain("supervisor="); // sin id ficticio: sin parámetro
    expect(screen.getByText("Sup Norte")).toBeInTheDocument();
    expect(screen.getByText("Sup Sur")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cerrar período/ })).not.toBeInTheDocument();

    const ana = screen.getByLabelText("Ana Pérez 09/10/2026");
    const beto = screen.getByLabelText("Beto Ruiz 09/10/2026");
    fireEvent.change(ana, { target: { value: "8" } });
    fireEvent.change(beto, { target: { value: "6" } });
    fireEvent.blur(beto);
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => [p.supervisorId, p.cells.map((c) => c.collaboratorId)])).toEqual([
      [6, [51]],
      [7, [52]],
    ]);
  });

  it("sin colaboradores muestra un estado vacío, sin errores", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ...consolidated(), rows: [] })));
    render(
      <ToastProvider>
        <WorkedDaysGrid ctx={ctx} supervisorId={null} />
      </ToastProvider>,
    );
    expect(await screen.findByText(/No hay colaboradores en las bases de los supervisores autorizados/)).toBeInTheDocument();
  });
});

describe("Horas extras — Todos los supervisores", () => {
  it("la captura se muestra sin pedir un supervisor y trae los colaboradores de todos los equipos", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return json(200, String(url).includes("overtime/months/check") ? { records: 0, errors: 0, warnings: 0, issues: [] } : []);
      }),
    );
    render(
      <ToastProvider>
        <OvertimeView ctx={ctx} />
      </ToastProvider>,
    );
    expect(await screen.findByRole("button", { name: /Agregar colaboradores/ })).toBeInTheDocument();
    expect(screen.queryByText(/Seleccione un supervisor/)).not.toBeInTheDocument();
    await waitFor(() => expect(urls.some((u) => u.includes("/collaborators?status=ACTIVE"))).toBe(true));
    expect(urls.find((u) => u.includes("/collaborators?"))).not.toContain("supervisor=");
    expect(screen.getByRole("status")).toHaveTextContent("0/2 supervisores cerraron");
  });
});
