import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import OvertimeDeleteDialog from "@/components/novedades/OvertimeDeleteDialog";
import NotificationBell from "@/components/NotificationBell";

// Eliminación de un registro de horas extras ya guardado y alertas de la
// campana (roja = eliminación, azul = colaborador nuevo). Ver docs/CHANGELOG.md
// § v1.169.0.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const RECORD = {
  id: 41,
  fullName: "Ana Pérez",
  cedula: "0102030405",
  date: "2026-10-12",
  overtimeHours: "2",
  saturdayHours: "",
};

function jsonResponse(status: number, body: unknown = null) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function renderDialog(onDone = vi.fn()) {
  render(
    <ToastProvider>
      <OvertimeDeleteDialog record={RECORD} onClose={vi.fn()} onDone={onDone} />
    </ToastProvider>,
  );
  return onDone;
}

afterEach(() => vi.unstubAllGlobals());

describe("OvertimeDeleteDialog", () => {
  it("muestra a quién afecta y aclara que el colaborador sigue en la base", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderDialog();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("0102030405")).toBeInTheDocument();
    expect(screen.getByText("12/10/2026")).toBeInTheDocument();
    expect(screen.getByText("sigue en la base oficial")).toBeInTheDocument();
  });

  it("envía un solo DELETE aunque se haga doble clic y avisa al terminar", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = renderDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Digitado por error" } });
    const button = screen.getByRole("button", { name: /eliminar registro/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/novedades/overtime/41");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Digitado por error" });
    await act(async () => resolve(jsonResponse(204)));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
  });

  it("si otro usuario ya lo eliminó (404) lo quita igual sin mostrar error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { error: "Registro no encontrado." })));
    const onDone = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /eliminar registro/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
  });

  it("si el período está cerrado muestra el motivo y no cierra", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(409, { error: "Octubre 2026 está cerrado." })),
    );
    const onDone = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /eliminar registro/i }));
    expect(await screen.findByText("Octubre 2026 está cerrado.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("NotificationBell — alertas administrativas", () => {
  it("distingue eliminación (roja) y colaborador nuevo (azul) con etiqueta de texto, no solo color", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          unreadCount: 3,
          notifications: [
            { id: "1", message: "Registro de horas extras eliminado: Ana", taskId: null, taskTitle: null, taskAssignedToId: null, read: false, category: "deletion", createdAt: new Date().toISOString() },
            { id: "2", message: "Nuevo colaborador registrado en la base: Beto", taskId: null, taskTitle: null, taskAssignedToId: null, read: false, category: "new_collaborator", createdAt: new Date().toISOString() },
            { id: "3", message: "Te asignaron una tarea", taskId: null, taskTitle: null, taskAssignedToId: null, read: false, category: "", createdAt: new Date().toISOString() },
          ],
        }),
      ),
    );
    const { container } = render(<NotificationBell currentUserId="1" />);
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Notificaciones" }));

    expect(screen.getByText("Eliminación")).toBeInTheDocument();
    expect(screen.getByText("Nuevo colaborador")).toBeInTheDocument();
    const red = container.querySelector('[data-alert="deletion"]');
    const blue = container.querySelector('[data-alert="new_collaborator"]');
    expect(red).toHaveClass("border-l-danger");
    expect(blue).toHaveClass("border-l-blue-600");
    expect(container.querySelectorAll("[data-alert]")).toHaveLength(2); // la común no se pinta
  });
});
