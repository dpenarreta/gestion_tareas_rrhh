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
    status: "active" as const,
    createdAt: "2026-01-01T00:00:00Z",
    dataConsentAccepted: true,
    dataConsentAcceptedAt: "2026-09-02T12:27:00Z",
  },
  {
    id: "2",
    name: "Beto Pendiente",
    email: "beto@example.com",
    role: "ASISTENTE_GH" as const,
    status: "active" as const,
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

describe("UsersManager — estado del usuario en la lista", () => {
  // Bug real reportado en producción (ver docs/AUDIT_LOG.md § 2026-09-10):
  // el botón "Eliminar" de un usuario hace una baja LÓGICA (Django ni
  // siquiera acepta DELETE sobre usuarios), pero el adaptador descartaba el
  // campo `status`, así que la fila quedaba idéntica después de confirmar.
  // Desde fuera era indistinguible de un botón roto.
  // Sin consentimiento aceptado a propósito: así su fila tiene un solo botón
  // "Eliminar" (el de la cuenta) y no también el del consentimiento, que
  // haría ambigua cada consulta por texto.
  const USUARIO_DE_BAJA = {
    ...USERS[0],
    id: "3",
    name: "Caro DeBaja",
    email: "caro@example.com",
    status: "disabled" as const,
    dataConsentAccepted: false,
    dataConsentAcceptedAt: null,
  };

  it("marca a los usuarios deshabilitados y no ensucia la fila de los activos", async () => {
    renderManager(
      vi.fn(async () => ({ ok: true, json: async () => [USERS[0], USUARIO_DE_BAJA] }) as Response)
    );

    const filaDeBaja = (await screen.findByText("Caro DeBaja")).closest("tr")!;
    expect(within(filaDeBaja).getByText("Deshabilitado")).toBeInTheDocument();

    const filaActiva = screen.getByText("Ana Aceptó").closest("tr")!;
    expect(within(filaActiva).queryByText("Deshabilitado")).not.toBeInTheDocument();
    expect(within(filaActiva).queryByText("Activo")).not.toBeInTheDocument();
  });

  it("distingue una cuenta bloqueada de una deshabilitada", async () => {
    renderManager(
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => [{ ...USUARIO_DE_BAJA, name: "Dani Bloqueada", status: "blocked" }],
          }) as Response
      )
    );

    const fila = (await screen.findByText("Dani Bloqueada")).closest("tr")!;
    expect(within(fila).getByText("Bloqueado")).toBeInTheDocument();
  });

  it("una cuenta activa ofrece 'Dar de baja', no 'Eliminar'", async () => {
    // Las dos operaciones existen desde 2026-09-11 y son distintas: la baja
    // es reversible, el borrado no. Eliminar solo tiene sentido sobre una
    // cuenta ya dada de baja, que es además lo que Django exige.
    renderManager(
      vi.fn(async () => ({ ok: true, json: async () => [USERS[0], USUARIO_DE_BAJA] }) as Response)
    );

    await screen.findByText("Ana Aceptó");
    const filaActiva = screen.getByText("Ana Aceptó").closest("tr")!;
    expect(within(filaActiva).getByText("Dar de baja")).toBeInTheDocument();

    const filaDeBaja = screen.getByText("Caro DeBaja").closest("tr")!;
    expect(within(filaDeBaja).getByText("Eliminar")).toBeInTheDocument();
    expect(within(filaDeBaja).queryByText("Dar de baja")).not.toBeInTheDocument();
  });

  it("el diálogo de baja explica que se puede revertir", async () => {
    renderManager(vi.fn(async () => ({ ok: true, json: async () => USERS }) as Response));

    await screen.findByText("Ana Aceptó");
    const fila = screen.getByText("Ana Aceptó").closest("tr")!;
    fireEvent.click(within(fila).getByText("Dar de baja"));

    // El texto viejo ("no se puede deshacer") era falso para una baja.
    const dialogo = await screen.findByText(/queda deshabilitada/i);
    expect(dialogo).toHaveTextContent(/se puede reactivar/i);
    expect(screen.queryByText(/no se puede deshacer/i)).not.toBeInTheDocument();
  });

  it("el diálogo de borrado avisa que es irreversible, y llama a DELETE al confirmar", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/users" && !init) {
        return { ok: true, json: async () => [USUARIO_DE_BAJA] } as Response;
      }
      if (url === "/api/users/3" && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`fetch no mockeado: ${url} ${init?.method ?? ""}`);
    });
    renderManager(fetchMock);

    await screen.findByText("Caro DeBaja");
    const fila = screen.getByText("Caro DeBaja").closest("tr")!;
    fireEvent.click(within(fila).getByText("Eliminar"));

    expect(await screen.findByText(/no se puede deshacer/i)).toBeInTheDocument();
    // Nada se borra antes de confirmar.
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => c[0] === "/api/users/3" && (c[1] as RequestInit)?.method === "DELETE"
        )
      ).toBe(true)
    );
  });

  it("muestra el motivo por el que el backend rechaza el borrado", async () => {
    const motivo =
      "No es posible eliminar a este usuario porque tiene información de trabajo asociada que se perdería (3 tareas).";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/users" && !init) {
        return { ok: true, json: async () => [USUARIO_DE_BAJA] } as Response;
      }
      return { ok: false, json: async () => ({ error: motivo }) } as Response;
    });
    renderManager(fetchMock);

    await screen.findByText("Caro DeBaja");
    const fila = screen.getByText("Caro DeBaja").closest("tr")!;
    fireEvent.click(within(fila).getByText("Eliminar"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(motivo)).toBeInTheDocument();
  });
});
