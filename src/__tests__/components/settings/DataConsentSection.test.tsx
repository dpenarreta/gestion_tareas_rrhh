import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import DataConsentSection from "@/components/settings/DataConsentSection";

// Pedido explícito del usuario (ver docs/AUDIT_LOG.md § 2026-09-02,
// "Consentimiento de datos editable desde Ajustes"): nuevo botón "Editar
// contenido" junto a "Restablecer todos" que abre un editor del Markdown
// del aviso de Tratamiento de Datos Personales
// (`GET`/`PUT /api/settings/consent-text`). No existía ningún test de
// `DataConsentSection.tsx` hasta ahora — este archivo cubre puntualmente
// el flujo de edición nuevo, no el resto de la sección (ya cubierto
// indirectamente por `UsersManager.test.tsx` para la parte de reseteo).

const USERS = [
  {
    id: "1",
    name: "Ana Aceptó",
    role: "ASISTENTE_GH" as const,
    dataConsentAccepted: true,
    dataConsentAcceptedAt: "2026-09-02T12:27:00Z",
  },
];

const CURRENT_TEXT = "Texto actual del aviso de tratamiento de datos.";

function mockFetch(
  overrides: {
    consentTextGet?: () => Promise<Response>;
    consentTextPut?: () => Promise<Response>;
    resetOne?: () => Promise<Response>;
    resetAll?: () => Promise<Response>;
  } = {}
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/settings/consent-text" && init === undefined) {
      if (overrides.consentTextGet) return overrides.consentTextGet();
      return { ok: true, json: async () => ({ text: CURRENT_TEXT }) } as Response;
    }
    if (url === "/api/settings/consent-text" && init?.method === "PUT") {
      if (overrides.consentTextPut) return overrides.consentTextPut();
      const body = JSON.parse(init.body as string);
      return { ok: true, json: async () => ({ text: body.text }) } as Response;
    }
    if (url === "/api/users/1/reset-consent" && init?.method === "PATCH") {
      if (overrides.resetOne) return overrides.resetOne();
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    if (url === "/api/users/reset-consent-all" && init?.method === "PATCH") {
      if (overrides.resetAll) return overrides.resetAll();
      return { ok: true, json: async () => ({ count: 1 }) } as Response;
    }
    throw new Error(`fetch no mockeado: ${url} ${init?.method ?? "GET"}`);
  });
}

function renderSection(fetchImpl: ReturnType<typeof mockFetch> = mockFetch(), onUsersChanged = vi.fn()) {
  vi.stubGlobal("fetch", fetchImpl);
  return render(
    <ToastProvider>
      <DataConsentSection users={USERS} loading={false} onUsersChanged={onUsersChanged} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("DataConsentSection — editar contenido del aviso", () => {
  it("al hacer clic en 'Editar contenido' carga el texto vigente en el textarea", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Editar contenido/i }));

    expect(await screen.findByText("Editar tratamiento de datos personales")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue(CURRENT_TEXT);
    });
  });

  it("Guardar envía el texto editado por PUT y muestra éxito", async () => {
    const fetchMock = mockFetch();
    renderSection(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: /Editar contenido/i }));
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue(CURRENT_TEXT);
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nuevo texto editado." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(screen.getByText("Contenido del tratamiento de datos actualizado.")).toBeInTheDocument();
    });
    const putCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/settings/consent-text" && (c[1] as RequestInit)?.method === "PUT"
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ text: "Nuevo texto editado." });
    // El modal se cierra tras guardar con éxito.
    await waitFor(() => {
      expect(screen.queryByText("Editar tratamiento de datos personales")).not.toBeInTheDocument();
    });
  });

  it("si el PUT falla, muestra el error real y deja el modal abierto para reintentar", async () => {
    renderSection(
      mockFetch({
        consentTextPut: async () => ({ ok: false, json: async () => ({ error: "El texto no puede quedar vacío" }) }) as Response,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Editar contenido/i }));
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue(CURRENT_TEXT);
    });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(screen.getByText("El texto no puede quedar vacío")).toBeInTheDocument();
    });
    expect(screen.getByText("Editar tratamiento de datos personales")).toBeInTheDocument();
  });

  it("si falla la carga inicial del texto vigente, avisa y cierra el modal", async () => {
    renderSection(
      mockFetch({
        consentTextGet: async () => ({ ok: false, json: async () => ({ error: "boom" }) }) as Response,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Editar contenido/i }));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("Editar tratamiento de datos personales")).not.toBeInTheDocument();
    });
  });

  it("Cancelar cierra el modal sin llamar a PUT", async () => {
    const fetchMock = mockFetch();
    renderSection(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: /Editar contenido/i }));
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue(CURRENT_TEXT);
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByText("Editar tratamiento de datos personales")).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(false);
  });
});

// Hallazgo real (ver docs/AUDIT_LOG.md § 2026-09-02, "Restablecer
// consentimiento usaba confirm() nativo en vez de ConfirmDialog"): el
// usuario notó que este diálogo se veía distinto al resto del sistema —
// bug preexistente heredado 1:1 del SettingsManager.tsx original, nunca
// migrado a `ConfirmDialog` como sí ocurrió en el resto de la app.
describe("DataConsentSection — restablecer con ConfirmDialog (no confirm() nativo)", () => {
  it("Restablecer (individual) pide confirmación antes de llamar al PATCH, y confirma que llama al endpoint correcto", async () => {
    const fetchMock = mockFetch();
    const onUsersChanged = vi.fn();
    renderSection(fetchMock, onUsersChanged);

    fireEvent.click(screen.getByText("🔄 Restablecer"));

    expect(await screen.findByText("Restablecer consentimiento")).toBeInTheDocument();
    expect(
      screen.getByText(/¿Deseas que Ana Aceptó vea nuevamente el aviso de protección de datos en su próximo login\?/)
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/users/1/reset-consent")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Restablecer" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/users/1/reset-consent" && (c[1] as RequestInit)?.method === "PATCH")).toBe(true)
    );
    await waitFor(() => expect(onUsersChanged).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText("Restablecer consentimiento")).not.toBeInTheDocument();
    });
  });

  it("Restablecer todos pide confirmación antes de llamar al PATCH masivo", async () => {
    const fetchMock = mockFetch();
    const onUsersChanged = vi.fn();
    renderSection(fetchMock, onUsersChanged);

    fireEvent.click(screen.getByRole("button", { name: /Restablecer todos/i }));

    expect(await screen.findByRole("heading", { name: "Restablecer todos" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/users/reset-consent-all")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Restablecer todos" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/users/reset-consent-all" && (c[1] as RequestInit)?.method === "PATCH")
      ).toBe(true)
    );
    await waitFor(() => expect(onUsersChanged).toHaveBeenCalled());
  });

  it("Cancelar en el diálogo de restablecer no llama al endpoint", async () => {
    const fetchMock = mockFetch();
    renderSection(fetchMock);

    fireEvent.click(screen.getByText("🔄 Restablecer"));
    expect(await screen.findByText("Restablecer consentimiento")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByText("Restablecer consentimiento")).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/users/1/reset-consent")).toBe(false);
  });

  it("si el PATCH de restablecer falla, muestra el error real", async () => {
    renderSection(
      mockFetch({
        resetOne: async () => ({ ok: false, json: async () => ({ error: "Sin permisos" }) }) as Response,
      })
    );

    fireEvent.click(screen.getByText("🔄 Restablecer"));
    fireEvent.click(await screen.findByRole("button", { name: "Restablecer" }));

    expect(await screen.findByText("Sin permisos")).toBeInTheDocument();
  });
});
