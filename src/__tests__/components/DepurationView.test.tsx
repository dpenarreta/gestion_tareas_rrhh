import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import DepurationView from "@/components/novedades/DepurationView";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";

// Horas Depuradas: copia independiente que edita el Jefe de Operaciones con
// guardado automático; el Administrador solo consulta (ver docs/CHANGELOG.md § v1.175.0).

const ctx = (id = 30) =>
  ({ overtimeMonth: "2026-09", me: { user: { id, name: "Jefe" } }, setDirty: vi.fn() }) as unknown as ModuleContext;

const fields = (h: string) => ({
  overtimeHours: h, saturdayHours: "0", isSaturday: false, isSunday: false, isHoliday: false, workDone: "Inventario", observations: "",
});

const ROW = {
  id: 501, sourceId: 77, version: 1, date: "2026-09-15", cedula: "0102030405", fullName: "Ana Pérez",
  supervisorName: "Sup Norte", excluded: false, modified: false, sourceState: "", original: fields("10"),
  current: fields("10"), differenceHours: "0",
};

function status(over: Record<string, unknown> = {}) {
  return {
    period: "2026-09", label: "Septiembre 2026", exists: true, canCreate: false, canEdit: true, monthEnded: true,
    source: { records: 1, overtimeHours: "10", saturdayHours: "0", supervisorsTotal: 2, supervisorsClosed: 2 },
    depuration: {
      id: 9, createdAt: "2026-10-12T15:00:00Z", createdBy: "Jefe", sourceCount: 1, sourceOvertimeHours: "10",
      sourceSaturdayHours: "0", supervisorsTotal: 2, supervisorsClosed: 2, rows: 1, excluded: 0, modified: 0,
      overtimeHours: "10", saturdayHours: "0", lastChangeAt: null, lastChangeBy: "",
    },
    ...over,
  };
}

function json(code: number, body: unknown) {
  return { ok: code < 400, status: code, json: async () => body } as Response;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function renderView(c = ctx()) {
  return render(
    <ToastProvider>
      <DepurationView ctx={c} />
    </ToastProvider>,
  );
}

describe("DepurationView", () => {
  it("el Jefe crea la base del mes (una vez) y luego la edita", async () => {
    let created = false;
    const posts: string[] = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(String(url));
          created = true;
          return json(200, { ...status(), created: true });
        }
        if (String(url).includes("depuration/rows")) return json(200, created ? [ROW] : []);
        return json(200, created ? status() : status({ exists: false, canCreate: true, depuration: undefined }));
      }),
    );
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Crear base de depuración/ }));
    await waitFor(() => expect(posts).toEqual(["/api/novedades/depuration/create"]));
    expect(await screen.findByLabelText("# Horas extras Ana Pérez 15/09/2026")).toHaveValue("10");
    expect(screen.queryByRole("button", { name: /Crear base de depuración/ })).not.toBeInTheDocument();
  });

  it("guarda automáticamente, conserva el original a la vista y confirma solo con el servidor", async () => {
    const saves: { rows: { id: number; version: number; overtimeHours: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          saves.push(JSON.parse(String(init.body)));
          return json(200, { rows: [{ clientKey: "501", status: "updated", errors: {}, id: 501, version: 2 }] });
        }
        if (String(url).includes("depuration/rows")) return json(200, [ROW]);
        return json(200, status());
      }),
    );
    renderView();
    const input = await screen.findByLabelText("# Horas extras Ana Pérez 15/09/2026");
    expect(screen.queryByRole("button", { name: /^Guardar/ })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "8" } });
    expect(screen.getByText("orig. 10")).toBeInTheDocument(); // el original sigue visible
    fireEvent.blur(input);
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].rows[0]).toMatchObject({ id: 501, version: 1, overtimeHours: "8" });
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument(); // diferencia frente al original
  });

  it("el Administrador solo consulta: sin crear ni editar, pero puede exportar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("depuration/rows") ? json(200, [{ ...ROW, sourceState: "changed" }]) : json(200, status({ canEdit: false })),
      ),
    );
    renderView(ctx(1));
    expect(await screen.findByLabelText("# Horas extras Ana Pérez 15/09/2026")).toBeDisabled();
    expect(screen.getByText("Solo consulta")).toBeInTheDocument();
    expect(screen.getByText("Cambió después de copiar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar depuradas/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crear base/ })).not.toBeInTheDocument();
  });

  it("sin base en el mes muestra un estado informativo, sin errores", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, status({ exists: false, canEdit: false, depuration: undefined }))));
    renderView(ctx(1));
    expect(await screen.findByText(/Todavía no existe la base depurable de este mes/)).toBeInTheDocument();
  });
});
