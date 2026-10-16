import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import WorkedDaysGrid from "@/components/novedades/WorkedDaysGrid";
import OvertimeCapture from "@/components/novedades/OvertimeCapture";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";
import type { OvertimeMonth, WorkedDaysMatrix } from "@/components/novedades/types";

// Guardado automático de Días laborados y Horas extras: sin botones, con
// respaldo local y reintentos, y sin presentar como guardado lo que el
// servidor no confirmó (ver docs/CHANGELOG.md § v1.174.0).

const ctx = {
  period: "2026-10",
  can: (c: string) => c !== "novedades.corregir_cerrado",
  me: { nationalWrite: false, isAssistant: false, user: { id: 6, name: "Sup" }, deadlineRules: {
    today: "2026-10-12",
    canBypassDeadline: false,
    workedDays: { hours: 48, earliestOpenDate: "2026-10-08" },
    overtime: { hours: 48, earliestOpenDate: "2026-10-08" },
  } },
  setDirty: vi.fn(),
  refreshPeriods: vi.fn(),
} as unknown as ModuleContext;

function matrix(cells: Record<string, { hours: string | null; version: number }> = {}): WorkedDaysMatrix {
  return {
    period: { code: "2026-10", label: "Octubre 2026", startDate: "2026-09-23", endDate: "2026-10-22", status: "OPEN", closedAt: null, closedBy: "" },
    supervisor: { id: 6, name: "Sup" },
    editable: true,
    closable: true,
    columns: [
      { date: "2026-10-07", day: 7, weekday: "Miércoles", isWeekend: false, holiday: "", deadlineState: "expired", deadlineLabel: "viernes 09/10/2026 23:59" },
      { date: "2026-10-09", day: 9, weekday: "Viernes", isWeekend: false, holiday: "", deadlineState: "", deadlineLabel: "martes 13/10/2026 23:59" },
      { date: "2026-10-13", day: 13, weekday: "Martes", isWeekend: false, holiday: "", deadlineState: "future", deadlineLabel: "" },
    ],
    rows: [
      { collaboratorId: 5, cedula: "0102030405", fullName: "Ana Pérez", cargo: "Operador", area: "", regional: "", status: "ACTIVE", isCurrentMember: true, cells, totalHours: "0" },
    ],
  } as unknown as WorkedDaysMatrix;
}

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function renderGrid() {
  return render(
    <ToastProvider>
      <WorkedDaysGrid ctx={ctx} supervisorId={6} />
    </ToastProvider>,
  );
}

describe("Días laborados — guardado automático", () => {
  it("guarda al salir de la celda, sin botón, y confirma solo con la respuesta del servidor", async () => {
    let saved = false;
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          saved = true;
          return json(200, { saved: 1 });
        }
        return json(200, matrix(saved ? { "2026-10-09": { hours: "8", version: 1 } } : {}));
      }),
    );
    renderGrid();
    const cell = await screen.findByLabelText("Ana Pérez 09/10/2026");
    // El mensaje fijo retirado ya no aparece, ni botones de guardar.
    expect(screen.queryByText(/Sin cambios pendientes/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();
    fireEvent.change(cell, { target: { value: "8" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ cells: [{ collaboratorId: 5, date: "2026-10-09", hours: "8", version: null }] });
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0); // nada pendiente
  });

  it("bloquea fechas vencidas y futuras según el servidor; vacío ≠ 0 se conserva", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, matrix({ "2026-10-09": { hours: "0", version: 1 } }))));
    renderGrid();
    expect(await screen.findByLabelText("Ana Pérez 07/10/2026")).toBeDisabled();
    expect(screen.getByLabelText("Ana Pérez 13/10/2026")).toBeDisabled();
    expect(screen.getByLabelText("Ana Pérez 09/10/2026")).toHaveValue("0"); // cero reportado, no vacío
    expect(screen.getByLabelText("Ana Pérez 07/10/2026")).toHaveValue(""); // vacío = no reportado
  });

  it("sin conexión conserva el cambio, lo marca pendiente y lo envía al reintentar", async () => {
    let online = false;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts++;
          if (!online) throw new TypeError("Failed to fetch");
          return json(200, { saved: 1 });
        }
        return json(200, matrix());
      }),
    );
    renderGrid();
    const cell = await screen.findByLabelText("Ana Pérez 09/10/2026");
    fireEvent.change(cell, { target: { value: "7,5" } });
    fireEvent.blur(cell);
    // Espera el intento fallido real (no solo el estado "pendiente" previo al envío).
    expect(await screen.findByText(/se reintentará automáticamente/)).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de sincronización/)).toBeInTheDocument();
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument(); // sin éxito anticipado
    expect(window.localStorage.getItem("nexo:novedades:pendiente:dias|2026-10|6|6")).toContain("7,5");
    online = true;
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar ahora" }));
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
    expect(posts).toBe(2); // un intento fallido y uno exitoso: sin duplicados
  });

  it("recupera lo pendiente de una visita anterior y lo envía solo", async () => {
    window.localStorage.setItem(
      "nexo:novedades:pendiente:dias|2026-10|6|6",
      JSON.stringify({ savedAt: Date.now(), value: { "5|2026-10-09": "6" } }),
    );
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return json(200, { saved: 1 });
        }
        return json(200, matrix());
      }),
    );
    renderGrid();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ cells: [{ date: "2026-10-09", hours: "6" }] });
  });

  it("un rechazo del servidor (plazo vencido) se marca y no se reintenta en bucle", async () => {
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts++;
          return json(400, {
            error: "Hay celdas con errores; no se guardó ningún cambio.",
            details: { cells: [{ collaboratorId: 5, date: "2026-10-09", message: "El plazo venció", code: "deadline_passed" }] },
          });
        }
        return json(200, matrix());
      }),
    );
    renderGrid();
    const cell = await screen.findByLabelText("Ana Pérez 09/10/2026");
    fireEvent.change(cell, { target: { value: "8" } });
    fireEvent.blur(cell);
    expect(await screen.findByText("Error al guardar")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(posts).toBe(1);
    expect(cell).toHaveValue("8"); // el valor escrito se conserva para corregirlo
  });
});

describe("Horas extras — guardado automático", () => {
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
  };

  function row(key: string, date: string) {
    return {
      key, id: null, version: null, collaboratorId: 5, cedula: "0102030405", fullName: "Ana Pérez",
      regional: "", area: "", cargo: "", date, overtimeHours: "2", saturdayHours: "",
      isSaturday: false, isSunday: false, isHoliday: null, workDone: "", observations: "",
      state: "new", dirty: true, errors: {}, rev: 1,
    };
  }

  it("envía solas las filas válidas recuperadas; las de fecha vencida quedan como borrador", async () => {
    window.localStorage.setItem(
      "nexo:novedades:pendiente:horas|2026-10|6|6",
      JSON.stringify({ savedAt: Date.now(), value: [row("a", "2026-10-09"), row("b", "2026-10-05")] }),
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
            rows: body.rows.map((r: { clientKey: string }) => ({ clientKey: r.clientKey, status: "created", errors: {}, recordId: 77, version: 1 })),
          });
        }
        return json(200, []);
      }),
    );
    render(
      <ToastProvider>
        <OvertimeCapture ctx={ctx} supervisorId={6} month={month} />
      </ToastProvider>,
    );
    await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 4000 });
    expect(bodies[0].rows.map((r) => r.clientKey)).toEqual(["a"]); // la del 05/10 venció: no se envía
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Guardar/ })).not.toBeInTheDocument();
  });
});

describe("deadlineError — permiso «Editar celdas de Días laborados»", () => {
  const base = {
    today: "2026-10-12",
    canBypassDeadline: false,
    workedDays: { hours: 48, earliestOpenDate: "2026-10-08", canBypass: true },
    overtime: { hours: 48, earliestOpenDate: "2026-10-08", canBypass: false },
  };

  it("levanta el plazo solo en Días laborados, nunca fechas futuras", async () => {
    const { deadlineError } = await import("@/lib/novedadesAutosave");
    expect(deadlineError("2026-10-07", base, "workedDays")).toBeNull();
    expect(deadlineError("2026-10-07", base, "overtime")).toMatch(/plazo de esta fecha venció/);
    expect(deadlineError("2026-10-13", base, "workedDays")).toMatch(/Fecha futura/);
  });
});
