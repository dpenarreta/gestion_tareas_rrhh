import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * El cierre de mes es MANUAL y nada lo dispara solo. Un mes que nadie cerró no
 * avisaba de ninguna forma: sus tareas no pasaban al repositorio y sus
 * recurrentes nunca generaban la instancia del mes siguiente, que es justo lo
 * que se pidió que ocurriera.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { default: TasksModule } = await import("@/components/tasks/TasksModule");

function mockFetch(pendingClosures: { year: number; month: number }[]) {
  return vi.fn(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/tasks/close-month")) {
      return { ok: true, json: async () => ({ pendingClosures }) } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  });
}

function montar(rol: "JEFE_NACIONAL" | "ASISTENTE_GH" = "JEFE_NACIONAL") {
  return render(
    <TasksModule
      initialTasks={[]}
      initialViews={["KANBAN", "TABLA"]}
      initialUsers={[]}
      currentUserId="1"
      currentUserRole={rol}
      currentActivityFormat="duration"
    />
  );
}

describe("Aviso de meses sin cerrar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("avisa, nombrando el mes, cuando quedó uno sin cerrar", async () => {
    global.fetch = mockFetch([{ year: 2026, month: 9 }]) as unknown as typeof fetch;

    montar();

    expect(await screen.findByText(/Septiembre 2026 quedó sin cerrar/)).toBeTruthy();
  });

  it("explica la consecuencia, no solo que falta cerrarlo", async () => {
    global.fetch = mockFetch([{ year: 2026, month: 9 }]) as unknown as typeof fetch;

    montar();

    const texto = await screen.findByText(/no generan su instancia del mes siguiente/);
    expect(texto.textContent).toMatch(/no pasan al repositorio/);
  });

  it("con varios meses los lista todos", async () => {
    global.fetch = mockFetch([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]) as unknown as typeof fetch;

    montar();

    expect(await screen.findByText(/2 meses quedaron sin cerrar/)).toBeTruthy();
    expect(screen.getByText(/Agosto 2026, Septiembre 2026/)).toBeTruthy();
  });

  it("el botón lleva al más viejo, que es el que hay que cerrar primero", async () => {
    global.fetch = mockFetch([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]) as unknown as typeof fetch;

    montar();

    expect(await screen.findByRole("button", { name: /Cerrar Agosto 2026/ })).toBeTruthy();
  });

  it("sin meses pendientes no muestra nada", async () => {
    global.fetch = mockFetch([]) as unknown as typeof fetch;

    montar();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/quedó sin cerrar/)).toBeNull();
    expect(screen.queryByText(/quedaron sin cerrar/)).toBeNull();
  });

  it("a quien no puede cerrar el mes no se le consulta ni se le avisa", async () => {
    const fetchMock = mockFetch([{ year: 2026, month: 9 }]);
    global.fetch = fetchMock as unknown as typeof fetch;

    montar("ASISTENTE_GH");

    // El endpoint exige el permiso de cierre: pedirlo daría 403, y el aviso no
    // le serviría de nada a quien no puede actuar sobre él.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/tasks/close-month"))).toBe(false)
    );
    expect(screen.queryByText(/quedó sin cerrar/)).toBeNull();
  });
});
