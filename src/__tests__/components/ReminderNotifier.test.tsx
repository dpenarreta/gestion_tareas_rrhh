import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ReminderNotifier from "@/components/reminders/ReminderNotifier";
import type { PendingReminder } from "@/components/tasks/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const pendingReminder: PendingReminder = {
  id: "rem-1",
  title: "Llamar al postulante",
  description: "Confirmar disponibilidad",
  reminderAt: new Date().toISOString(),
  task: { id: "task-1", title: "Selección vacante X" },
};

function mockFetchSequence(patchResponse: { ok: boolean; body?: unknown }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/reminders/pending") {
      return Promise.resolve({
        ok: true,
        json: async () => [pendingReminder],
      } as Response);
    }
    if (url === `/api/reminders/${pendingReminder.id}` && init?.method === "PATCH") {
      return Promise.resolve({
        ok: patchResponse.ok,
        json: async () => patchResponse.body ?? {},
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => [] } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openSnoozeMenu() {
  await waitFor(() => expect(screen.getByText("Llamar al postulante")).toBeInTheDocument());
  // El efecto que resetea showSnooze/showReschedule/error al cargar un nuevo recordatorio
  // agenda su actualización con queueMicrotask; se deja asentar antes de interactuar para
  // no competir con ese microtask (en uso real el humano nunca gana esa carrera, pero
  // fireEvent.click sí puede hacerlo bajo carga en el entorno de test).
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Posponer" }));
  await waitFor(() => expect(screen.getByText("5 minutos")).toBeInTheDocument());
}

describe("ReminderNotifier — posponer", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra las tres opciones de posponer (5 min, 30 min, 1 hora)", async () => {
    mockFetchSequence({ ok: true });
    render(<ReminderNotifier />);
    await openSnoozeMenu();
    expect(screen.getByText("5 minutos")).toBeInTheDocument();
    expect(screen.getByText("30 minutos")).toBeInTheDocument();
    expect(screen.getByText("1 hora")).toBeInTheDocument();
  });

  it("al hacer clic en '5 minutos' llama a PATCH con snoozedUntil ~5 min en el futuro y cierra el modal", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    const before = Date.now();
    render(<ReminderNotifier />);
    await openSnoozeMenu();

    fireEvent.click(screen.getByText("5 minutos"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => c[0] === `/api/reminders/${pendingReminder.id}` && c[1]?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
    });

    const patchCall = fetchMock.mock.calls.find(
      (c) => c[0] === `/api/reminders/${pendingReminder.id}` && c[1]?.method === "PATCH"
    )!;
    const body = JSON.parse(patchCall[1]!.body as string);
    const snoozedUntil = new Date(body.snoozedUntil).getTime();
    expect(snoozedUntil).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 2000);
    expect(snoozedUntil).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 5000);

    // El modal se cierra (deja de mostrar el recordatorio) tras un posponer exitoso.
    await waitFor(() => expect(screen.queryByText("Llamar al postulante")).not.toBeInTheDocument());
  });

  it("al hacer clic en '30 minutos' calcula snoozedUntil +30min y cierra el modal", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    const before = Date.now();
    render(<ReminderNotifier />);
    await openSnoozeMenu();

    fireEvent.click(screen.getByText("30 minutos"));

    await waitFor(() => expect(screen.queryByText("Llamar al postulante")).not.toBeInTheDocument());

    const patchCall = fetchMock.mock.calls.find(
      (c) => c[0] === `/api/reminders/${pendingReminder.id}` && c[1]?.method === "PATCH"
    )!;
    const body = JSON.parse(patchCall[1]!.body as string);
    const snoozedUntil = new Date(body.snoozedUntil).getTime();
    expect(snoozedUntil).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 2000);
    expect(snoozedUntil).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 5000);
  });

  it("al hacer clic en '1 hora' calcula snoozedUntil +60min y cierra el modal", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    const before = Date.now();
    render(<ReminderNotifier />);
    await openSnoozeMenu();

    fireEvent.click(screen.getByText("1 hora"));

    await waitFor(() => expect(screen.queryByText("Llamar al postulante")).not.toBeInTheDocument());

    const patchCall = fetchMock.mock.calls.find(
      (c) => c[0] === `/api/reminders/${pendingReminder.id}` && c[1]?.method === "PATCH"
    )!;
    const body = JSON.parse(patchCall[1]!.body as string);
    const snoozedUntil = new Date(body.snoozedUntil).getTime();
    expect(snoozedUntil).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 2000);
    expect(snoozedUntil).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 5000);
  });

  it("si el PATCH responde con error, muestra el mensaje y NO cierra el modal", async () => {
    mockFetchSequence({ ok: false, body: { error: "No se pudo posponer" } });
    render(<ReminderNotifier />);
    await openSnoozeMenu();

    fireEvent.click(screen.getByText("30 minutos"));

    await waitFor(() => expect(screen.getByText("No se pudo posponer")).toBeInTheDocument());
    expect(screen.getByText("Llamar al postulante")).toBeInTheDocument();
  });

  it("si el fetch de PATCH lanza una excepción de red, muestra un mensaje de error genérico y NO cierra el modal", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/reminders/pending") {
        return Promise.resolve({ ok: true, json: async () => [pendingReminder] } as Response);
      }
      return Promise.reject(new Error("network down"));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReminderNotifier />);
    await openSnoozeMenu();

    fireEvent.click(screen.getByText("1 hora"));

    await waitFor(() => expect(screen.getByText("Error de conexión. Intenta nuevamente.")).toBeInTheDocument());
    expect(screen.getByText("Llamar al postulante")).toBeInTheDocument();
  });
});
