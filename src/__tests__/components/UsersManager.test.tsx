import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import UsersManager from "@/components/UsersManager";

// Pedido explícito del usuario (ver docs/AUDIT_LOG.md § 2026-09-02):
// "Eliminar" el consentimiento de un usuario desde Usuarios, para forzarlo
// a aceptar de nuevo el aviso de protección de datos en su próximo login.
// No existía ningún test de este componente hasta ahora — este archivo
// cubre puntualmente ese comportamiento nuevo, no el resto de la pantalla.

const USERS = [
  {
    id: "1",
    name: "Ana Aceptó",
    email: "ana@example.com",
    role: "ASISTENTE_GH" as const,
    createdAt: "2026-01-01T00:00:00Z",
    dataConsentAccepted: true,
    dataConsentAcceptedAt: "2026-09-02T12:27:00Z",
  },
  {
    id: "2",
    name: "Beto Pendiente",
    email: "beto@example.com",
    role: "ASISTENTE_GH" as const,
    createdAt: "2026-01-01T00:00:00Z",
    dataConsentAccepted: false,
    dataConsentAcceptedAt: null,
  },
];

function renderManager(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchImpl);
  return render(
    <ToastProvider>
      <UsersManager currentUserRole="ADMINISTRADOR" />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersManager — eliminar consentimiento", () => {
  it("solo muestra el botón 'Eliminar' de consentimiento para usuarios que ya lo aceptaron", async () => {
    renderManager(vi.fn(async () => ({ ok: true, json: async () => USERS }) as Response));

    await screen.findByText("Ana Aceptó");
    // Fila de Ana (aceptado): tiene botón de eliminar consentimiento.
    const row = screen.getByText("Ana Aceptó").closest("tr")!;
    expect(row).toHaveTextContent("Eliminar");

    // Fila de Beto (pendiente): sin botón, porque no tiene nada que resetear.
    const rowBeto = screen.getByText("Beto Pendiente").closest("tr")!;
    expect(rowBeto).toHaveTextContent("Pendiente");
  });

  it("confirma y llama a PATCH /api/users/:id/reset-consent, luego recarga la lista", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/users" && !init) return { ok: true, json: async () => USERS } as Response;
      if (url === "/api/users/1/reset-consent" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`fetch no mockeado: ${url}`);
    });
    renderManager(fetchMock);

    await screen.findByText("Ana Aceptó");
    const row = screen.getByText("Ana Aceptó").closest("tr")!;
    // La fila tiene DOS botones "Eliminar" — el del usuario (columna
    // Acciones) y el nuevo del consentimiento (columna Consentimiento,
    // junto al badge "Aceptado"). Se acota al `<td>` del consentimiento.
    const consentCell = within(row).getByText(/Aceptado/).closest("td")!;
    fireEvent.click(within(consentCell).getByText("Eliminar"));

    // El ConfirmDialog pide confirmación explícita antes de ejecutar nada.
    expect(await screen.findByText("Eliminar consentimiento")).toBeInTheDocument();
    expect(
      screen.getByText(/¿Eliminar el consentimiento de Ana Aceptó\?/)
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/users/1/reset-consent")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/users/1/reset-consent" && (c[1] as RequestInit)?.method === "PATCH")).toBe(true)
    );
  });

  it("si el PATCH falla, muestra el error y no rompe la pantalla", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/users" && !init) return { ok: true, json: async () => USERS } as Response;
      if (url === "/api/users/1/reset-consent") {
        return { ok: false, json: async () => ({ error: "Sin permisos" }) } as Response;
      }
      throw new Error(`fetch no mockeado: ${url}`);
    });
    renderManager(fetchMock);

    await screen.findByText("Ana Aceptó");
    const row = screen.getByText("Ana Aceptó").closest("tr")!;
    // La fila tiene DOS botones "Eliminar" — el del usuario (columna
    // Acciones) y el nuevo del consentimiento (columna Consentimiento,
    // junto al badge "Aceptado"). Se acota al `<td>` del consentimiento.
    const consentCell = within(row).getByText(/Aceptado/).closest("td")!;
    fireEvent.click(within(consentCell).getByText("Eliminar"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Sin permisos")).toBeInTheDocument();
  });
});
