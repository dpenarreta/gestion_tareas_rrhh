import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import HistoryView from "@/components/novedades/HistoryView";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";

// Historial de registros: los cambios a Inactivo/Suspendido se marcan en
// rojo CON etiqueta de texto; la reactivación conserva el diseño normal. La
// marca la decide Django (`highlight`). Ver docs/CHANGELOG.md § v1.170.0 y v1.171.0.

const ctx = { period: "2026-10", supervisorId: null } as unknown as ModuleContext;

function event(id: number, oldValue: string, newValue: string, highlight: string) {
  return {
    id,
    action: "collaborator.status_changed",
    actorName: "José Andaluz",
    actorRole: "SUPERVISOR_OPERACIONES",
    supervisorId: 10,
    supervisorName: "José Andaluz",
    period: id === 913 ? null : "2026-10",
    targetType: "collaborator",
    targetId: "24",
    targetLabel: "ACOSTA ACOSTA MARCELO FERNANDO (2100031935)",
    field: "status",
    oldValue,
    newValue,
    reason: "SALE",
    sourceFile: "",
    createdAt: "2026-10-12T23:01:55Z",
    highlight,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("HistoryView — cambios de estado", () => {
  it("marca en rojo y con etiqueta los eventos a Inactivo y Suspendido, no la reactivación", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        count: 3,
        results: [
          event(913, "Activo", "Inactivo", "danger"),
          event(912, "Inactivo", "Activo", ""),
          event(911, "Activo", "Suspendido", "danger"),
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<HistoryView ctx={ctx} />);

    await waitFor(() => expect(container.querySelectorAll("tbody tr")).toHaveLength(3));
    const red = container.querySelectorAll('tr[data-highlight="danger"]');
    expect(red).toHaveLength(2);
    red.forEach((row) => expect(row).toHaveClass("bg-danger/[.06]"));
    // Etiqueta de texto (no solo color) con el estado nuevo del evento.
    expect(within(red[0] as HTMLElement).getByText("Inactivo")).toHaveClass("text-danger");
    expect(within(red[1] as HTMLElement).getByText("Suspendido")).toHaveClass("text-danger");
    const normal = container.querySelector("tbody tr:not([data-highlight])") as HTMLElement;
    expect(within(normal).getByText("Activo")).not.toHaveClass("text-danger");
    // Se ven nombre, anterior, nuevo, responsable y motivo.
    expect(screen.getAllByText("ACOSTA ACOSTA MARCELO FERNANDO (2100031935)")).toHaveLength(3);
    expect(screen.getAllByText("SALE")).toHaveLength(3);
    // Evento antiguo sin período: se muestra con guion, no vacío.
    expect(screen.getByText("—")).toBeInTheDocument();
    // Pide el historial del período elegido (el backend incluye los eventos sin período de esas fechas).
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("period=2026-10");
  });
});

describe("HistoryView — nuevos ingresos", () => {
  it("marca en azul, con la etiqueta 'Nuevo ingreso', el alta de un colaborador", async () => {
    const created = {
      ...event(36, "", "ACTIVO", "info"),
      action: "collaborator.created",
      field: "",
      reason: "",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 1, results: [created] }) })),
    );
    const { container } = render(<HistoryView ctx={ctx} />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr")).toHaveLength(1));
    const row = container.querySelector('tr[data-highlight="info"]') as HTMLElement;
    expect(row).toHaveClass("bg-blue-500/[.07]");
    expect(within(row).getByText("Nuevo ingreso")).toHaveClass("text-blue-700");
    expect(within(row).getByText("Alta de colaborador")).toBeInTheDocument();
  });
});
