import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import WorkedDaysGrid from "@/components/novedades/WorkedDaysGrid";
import OvertimeCapture from "@/components/novedades/OvertimeCapture";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";
import type { OvertimeMonth, WorkedDaysMatrix } from "@/components/novedades/types";

// Arrastre tipo Excel con desplazamiento automático (Días laborados y Horas
// extras, mecanismo compartido `useDragFill`). jsdom no tiene diseño: se
// simulan la caja del contenedor, `elementFromPoint` (fila bajo el puntero
// según el desplazamiento) y los cuadros de animación. Ver CHANGELOG § v1.181.0.

const TOP = 100;
const HEIGHT = 200; // ~10 filas visibles
const ROW_H = 20;
const ROWS = 30;

const ctx = {
  period: "2026-10",
  can: (c: string) => c !== "novedades.corregir_cerrado",
  me: {
    nationalWrite: false,
    isAssistant: false,
    user: { id: 6, name: "Sup" },
    deadlineRules: {
      today: "2026-10-12",
      canBypassDeadline: false,
      workedDays: { hours: 48, earliestOpenDate: "2026-10-08" },
      overtime: { hours: 48, earliestOpenDate: "2026-10-08" },
    },
  },
  setDirty: vi.fn(),
  refreshPeriods: vi.fn(),
} as unknown as ModuleContext;

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

// ── Cuadros de animación controlados por la prueba ─────────────────────────
let frames: (() => void)[] = [];
function runFrames(n: number) {
  act(() => {
    for (let i = 0; i < n; i++) {
      const batch = frames;
      frames = [];
      batch.forEach((cb) => cb());
    }
  });
}

// ── Geometría simulada del contenedor de la tabla ──────────────────────────
function installGeometry() {
  const container = document.querySelector<HTMLElement>("tr[data-row]")!.closest<HTMLElement>(".overflow-auto")!;
  // Como un navegador: el desplazamiento se limita a [0, contenido - visible].
  const clampScroll = (prop: "scrollTop" | "scrollLeft", max: number) => {
    let value = 0;
    Object.defineProperty(container, prop, {
      configurable: true,
      get: () => value,
      set: (v: number) => {
        value = Math.min(max, Math.max(0, v));
      },
    });
  };
  clampScroll("scrollTop", ROWS * ROW_H - HEIGHT);
  clampScroll("scrollLeft", 400);
  container.getBoundingClientRect = () =>
    ({ top: TOP, bottom: TOP + HEIGHT, left: 0, right: 600, width: 600, height: HEIGHT, x: 0, y: TOP }) as DOMRect;
  document.elementFromPoint = ((x: number, y: number) => {
    const index = Math.min(ROWS - 1, Math.max(0, Math.floor((y - TOP + container.scrollTop) / ROW_H)));
    return container.querySelector(`tr[data-row="${index}"] td`);
  }) as typeof document.elementFromPoint;
  return container;
}
const yOfRow = (row: number, scrollTop = 0) => TOP + row * ROW_H - scrollTop + ROW_H / 2;

const pageScroll = vi.fn();
beforeEach(() => {
  window.localStorage.clear();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  window.scrollTo = pageScroll as unknown as typeof window.scrollTo;
  window.scrollBy = pageScroll as unknown as typeof window.scrollBy;
  pageScroll.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

// ── Días laborados ──────────────────────────────────────────────────────────

const DAY = "2026-10-09";
function matrix(values: Record<number, string | null> = {}): WorkedDaysMatrix {
  return {
    period: { code: "2026-10", label: "Octubre 2026", startDate: "2026-09-23", endDate: "2026-10-22", status: "OPEN", closedAt: null, closedBy: "" },
    supervisor: { id: 6, name: "Sup" },
    editable: true,
    closable: true,
    columns: [
      { date: "2026-10-08", day: 8, weekday: "Jueves", isWeekend: false, holiday: "", deadlineState: "", deadlineLabel: "" },
      { date: DAY, day: 9, weekday: "Viernes", isWeekend: false, holiday: "", deadlineState: "", deadlineLabel: "" },
      { date: "2026-10-10", day: 10, weekday: "Sábado", isWeekend: true, holiday: "", deadlineState: "", deadlineLabel: "" },
    ],
    rows: Array.from({ length: ROWS }, (_, i) => ({
      collaboratorId: 100 + i,
      cedula: `01020304${String(i).padStart(2, "0")}`,
      fullName: `Persona ${String(i).padStart(2, "0")}`,
      cargo: "",
      area: "",
      regional: "",
      // Fila 3: inactiva sin valor (no admite nuevos registros); fila 5: el día
      // lo registró otro equipo. Las dos están bloqueadas y no se rellenan.
      status: i === 3 ? "INACTIVE" : "ACTIVE",
      isCurrentMember: true,
      cells:
        i === 5
          ? { [DAY]: { hours: "4", version: 1, otherTeam: "Sup Sur" } }
          : i in values
            ? { [DAY]: { hours: values[i], version: 1 } }
            : {},
      totalHours: "0",
    })),
  } as unknown as WorkedDaysMatrix;
}

function mockGridServer(values: Record<number, string | null>) {
  const saves: { cells: { collaboratorId: number; date: string; hours: string | null }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        saves.push(body);
        return json(200, { saved: body.cells.length });
      }
      return json(200, matrix(values));
    }),
  );
  return saves;
}

async function renderGrid() {
  render(
    <ToastProvider>
      <WorkedDaysGrid ctx={ctx} supervisorId={6} />
    </ToastProvider>,
  );
  await screen.findByLabelText(`Persona 00 09/10/2026`);
  return installGeometry();
}

describe("Días laborados — arrastre tipo Excel", () => {
  it("rellena hacia abajo más allá de lo visible con desplazamiento automático y guarda en un solo envío", async () => {
    const saves = mockGridServer({ 0: "8", 7: "6" });
    const container = await renderGrid();
    fireEvent.focus(screen.getByLabelText("Persona 00 09/10/2026"));
    const handle = await screen.findByRole("button", { name: /Arrastre para copiar 8/ });

    fireEvent.mouseDown(handle, { clientX: 200, clientY: yOfRow(0) });
    fireEvent.mouseMove(window, { clientX: 200, clientY: yOfRow(4) });
    expect(document.querySelectorAll(".outline-dashed").length).toBe(5); // filas 0..4 resaltadas
    // Puntero quieto pegado al borde inferior: la tabla baja sola.
    fireEvent.mouseMove(window, { clientX: 200, clientY: TOP + HEIGHT - 1 });
    runFrames(120);
    expect(container.scrollTop).toBeGreaterThan(HEIGHT); // recorrió filas que no se veían
    expect(document.querySelectorAll(".outline-dashed").length).toBe(ROWS); // hasta la última
    fireEvent.mouseUp(window);
    runFrames(5);
    expect(frames).toEqual([]); // el desplazamiento se detuvo al soltar
    const afterUp = container.scrollTop;
    runFrames(10);
    expect(container.scrollTop).toBe(afterUp);
    expect(pageScroll).not.toHaveBeenCalled(); // nunca la página

    // Copia exacta (sin series), también sobre valores existentes (fila 7: 6 → 8);
    // las bloqueadas (fila 3 inactiva sin valor, fila 5 de otro equipo) no se tocan.
    expect(await screen.findByText(/valor copiado en 27 fila\(s\); 2 bloqueada\(s\) sin cambios/)).toBeInTheDocument();
    expect(screen.getByLabelText("Persona 29 09/10/2026")).toHaveValue("8");
    expect(screen.getByLabelText("Persona 07 09/10/2026")).toHaveValue("8");
    expect(screen.getByLabelText("Persona 05 09/10/2026")).toHaveValue("4");
    expect(screen.getByLabelText("Persona 03 09/10/2026")).toHaveValue("");

    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 4000 });
    const sent = saves[0].cells;
    expect(sent).toHaveLength(27);
    expect(new Set(sent.map((c) => c.hours))).toEqual(new Set(["8"]));
    expect(new Set(sent.map((c) => c.date))).toEqual(new Set([DAY])); // solo esa columna
    expect(sent.some((c) => c.collaboratorId === 103 || c.collaboratorId === 105)).toBe(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(saves).toHaveLength(1); // sin envíos duplicados
  });

  it("rellena hacia arriba con desplazamiento automático y Escape cancela sin tocar nada", async () => {
    const saves = mockGridServer({ 25: "7" });
    const container = await renderGrid();
    container.scrollTop = 20 * ROW_H; // la fila 25 está a la vista
    fireEvent.focus(screen.getByLabelText("Persona 25 09/10/2026"));
    const handle = await screen.findByRole("button", { name: /Arrastre para copiar 7/ });

    fireEvent.mouseDown(handle, { clientX: 200, clientY: yOfRow(25, container.scrollTop) });
    fireEvent.mouseMove(window, { clientX: 200, clientY: TOP - 30 }); // por encima del contenedor
    runFrames(60);
    expect(container.scrollTop).toBe(0); // subió hasta el principio
    fireEvent.mouseUp(window);
    expect(await screen.findByText(/valor copiado en 23 fila\(s\); 2 bloqueada\(s\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Persona 00 09/10/2026")).toHaveValue("7");

    // Escape a mitad de un arrastre: se cancela y no aplica nada.
    fireEvent.focus(screen.getByLabelText("Persona 00 09/10/2026"));
    const again = await screen.findByRole("button", { name: /Arrastre para copiar 7/ });
    fireEvent.mouseDown(again, { clientX: 200, clientY: yOfRow(0) });
    fireEvent.mouseMove(window, { clientX: 200, clientY: TOP + HEIGHT + 50 });
    runFrames(10);
    fireEvent.keyDown(window, { key: "Escape" });
    const stopped = container.scrollTop;
    runFrames(10);
    expect(container.scrollTop).toBe(stopped);
    expect(document.querySelectorAll(".outline-dashed").length).toBe(0);
    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 4000 });
    expect(saves[0].cells.every((c) => c.hours === "7")).toBe(true);
  });

  it("se desplaza en horizontal cerca de los bordes y no ofrece el controlador en celdas bloqueadas", async () => {
    mockGridServer({ 0: "8" });
    const container = await renderGrid();
    fireEvent.focus(screen.getByLabelText("Persona 00 09/10/2026"));
    const handle = await screen.findByRole("button", { name: /Arrastre para copiar 8/ });
    fireEvent.mouseDown(handle, { clientX: 300, clientY: yOfRow(0) });
    fireEvent.mouseMove(window, { clientX: 599, clientY: yOfRow(2) });
    runFrames(5);
    expect(container.scrollLeft).toBeGreaterThan(0);
    fireEvent.mouseUp(window);
    // Sábado (bloqueado) y celda vacía: sin controlador.
    fireEvent.focus(screen.getByLabelText("Persona 00 10/10/2026"));
    expect(screen.queryByRole("button", { name: /Arrastre para copiar/ })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText("Persona 01 08/10/2026"));
    expect(screen.queryByRole("button", { name: /Arrastre para copiar/ })).not.toBeInTheDocument();
  });

  it("si el servidor rechaza celdas, quedan marcadas y no se muestran como guardadas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return json(400, {
            error: "Hay celdas con errores; no se guardó ningún cambio.",
            details: { cells: [{ collaboratorId: 102, date: DAY, message: "El plazo venció", code: "deadline_passed" }] },
          });
        }
        return json(200, matrix({ 0: "8" }));
      }),
    );
    await renderGrid();
    fireEvent.focus(screen.getByLabelText("Persona 00 09/10/2026"));
    fireEvent.mouseDown(await screen.findByRole("button", { name: /Arrastre para copiar 8/ }), { clientX: 200, clientY: yOfRow(0) });
    fireEvent.mouseMove(window, { clientX: 200, clientY: yOfRow(2) });
    fireEvent.mouseUp(window);
    expect(await screen.findByText("Error al guardar", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Persona 02 09/10/2026").closest("td")!.className).toContain("bg-danger");
  });
});

// ── Horas extras ────────────────────────────────────────────────────────────

describe("Horas extras — arrastre más allá de lo visible", () => {
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

  const row = (i: number) => ({
    key: `k${i}`, id: null, version: null, collaboratorId: 200 + i, cedula: `09090909${String(i).padStart(2, "0")}`,
    fullName: `Colab ${String(i).padStart(2, "0")}`, regional: "", area: "", cargo: "", date: "2026-10-09",
    overtimeHours: i === 0 ? "5" : "1", saturdayHours: "", isSaturday: false, isSunday: false, isHoliday: null,
    workDone: "", observations: "", state: "new", dirty: false, errors: {}, rev: 1,
  });

  it("el rango sigue a las filas que aparecen al desplazarse y copia el valor en todas", async () => {
    window.localStorage.setItem(
      "nexo:novedades:pendiente:horas|2026-10|6|6",
      JSON.stringify({ savedAt: Date.now(), value: Array.from({ length: ROWS }, (_, i) => row(i)) }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));
    render(
      <ToastProvider>
        <OvertimeCapture ctx={ctx} supervisorId={6} month={month} />
      </ToastProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("tr[data-row]").length).toBe(ROWS));
    const container = installGeometry();
    const source = Array.from(document.querySelectorAll<HTMLInputElement>('tr[data-row="0"] input')).find((i) => i.value === "5")!;
    fireEvent.focus(source);
    const handle = await screen.findByRole("button", { name: /Arrastre hacia abajo para copiar el valor/ });
    fireEvent.mouseDown(handle, { clientX: 200, clientY: yOfRow(0) });
    fireEvent.mouseMove(window, { clientX: 200, clientY: TOP + HEIGHT + 40 }); // por debajo del contenedor
    runFrames(120);
    expect(container.scrollTop).toBeGreaterThan(HEIGHT);
    fireEvent.mouseUp(window);
    expect(await screen.findByText(/valor copiado en 29 fila\(s\)/)).toBeInTheDocument();
    const last = Array.from(document.querySelectorAll<HTMLInputElement>(`tr[data-row="${ROWS - 1}"] input`));
    expect(last.some((i) => i.value === "5")).toBe(true);
    expect(pageScroll).not.toHaveBeenCalled();
  });
});

describe("Días laborados — encabezado fijo y deshacer después del autoguardado", () => {
  it("al subir, el rango sigue a las filas tapadas por el encabezado fijo", async () => {
    mockGridServer({ 25: "7" });
    const container = await renderGrid();
    // Como un navegador: el encabezado (sticky) tapa los primeros 40 px del
    // contenedor. `elementFromPoint` devuelve su celda; `elementsFromPoint`
    // devuelve además la fila que queda debajo.
    const HEADER_H = 40;
    const header = container.querySelector<HTMLElement>("thead th")!;
    const rowCell = document.elementFromPoint.bind(document);
    const inHeader = (y: number) => y < TOP + HEADER_H;
    document.elementFromPoint = ((x: number, y: number) =>
      inHeader(y) ? header : rowCell(x, y)) as typeof document.elementFromPoint;
    document.elementsFromPoint = ((x: number, y: number) =>
      inHeader(y) ? [header, rowCell(x, y)!] : [rowCell(x, y)!]) as typeof document.elementsFromPoint;
    try {
      container.scrollTop = 20 * ROW_H;
      fireEvent.focus(screen.getByLabelText("Persona 25 09/10/2026"));
      const handle = await screen.findByRole("button", { name: /Arrastre para copiar 7/ });
      fireEvent.mouseDown(handle, { clientX: 200, clientY: yOfRow(25, container.scrollTop) });
      fireEvent.mouseMove(window, { clientX: 200, clientY: TOP - 30 }); // por encima del contenedor
      runFrames(60);
      expect(container.scrollTop).toBe(0);
      fireEvent.mouseUp(window);
      // Las 25 filas por encima (menos las 2 bloqueadas), no solo las visibles
      // bajo el encabezado al empezar.
      expect(await screen.findByText(/valor copiado en 23 fila\(s\); 2 bloqueada\(s\)/)).toBeInTheDocument();
      expect(screen.getByLabelText("Persona 00 09/10/2026")).toHaveValue("7");
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it("Deshacer revierte el relleno aunque ya se haya guardado", async () => {
    // Servidor con estado: lo guardado vuelve en la próxima carga.
    const store: Record<number, string | null> = { 6: "7" };
    const saves: { cells: { collaboratorId: number; hours: string | null }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          saves.push(body);
          for (const c of body.cells) store[c.collaboratorId - 100] = c.hours;
          return json(200, { saved: body.cells.length });
        }
        return json(200, matrix({ ...store }));
      }),
    );
    await renderGrid();
    fireEvent.focus(screen.getByLabelText("Persona 06 09/10/2026"));
    const handle = await screen.findByRole("button", { name: /Arrastre para copiar 7/ });
    fireEvent.mouseDown(handle, { clientX: 200, clientY: yOfRow(6) });
    fireEvent.mouseMove(window, { clientX: 200, clientY: yOfRow(8) });
    fireEvent.mouseUp(window);
    const undo = await screen.findByRole("button", { name: "Deshacer" });

    // Primero se guarda el relleno (el aviso sigue visible)...
    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 4000 });
    expect(saves[0].cells.map((c) => c.hours)).toEqual(["7", "7"]);
    await waitFor(() => expect(store[8]).toBe("7"));

    // ...y recién después se deshace: vuelve a guardar los valores previos.
    fireEvent.click(undo);
    await waitFor(() => expect(saves).toHaveLength(2), { timeout: 4000 });
    expect(saves[1].cells.map((c) => [c.collaboratorId, c.hours])).toEqual([
      [107, null],
      [108, null],
    ]);
    await waitFor(() => expect(screen.getByLabelText("Persona 08 09/10/2026")).toHaveValue(""));
  });
});
