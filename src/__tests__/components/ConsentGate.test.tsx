import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import ConsentGate from "@/components/ConsentGate";

// Hallazgo real (ver docs/AUDIT_LOG.md § 2026-09-02, "ConsentGate no
// mostraba ningún error si el PATCH fallaba"): antes de este fix, un
// fallo de red/sesión en `PATCH /api/auth/consent` dejaba al usuario sin
// ninguna señal de qué pasó — el botón volvía a su estado normal en
// silencio. Este archivo también cubre el pedido posterior (ver
// docs/AUDIT_LOG.md § 2026-09-02, "Consentimiento de datos editable desde
// Ajustes"): el contenido ahora se trae de `GET /api/settings/consent-text`
// en vez de estar hardcodeado, y el gate por scroll (ver más abajo) debe
// esperar a que ese contenido real esté cargado antes de evaluarse.

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const SAMPLE_TEXT = "Contenido de prueba del aviso de tratamiento de datos.";

function mockFetch(
  overrides: {
    consentText?: () => Promise<Response>;
    consentPatch?: () => Promise<Response>;
  } = {}
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/settings/consent-text" && init === undefined) {
      if (overrides.consentText) return overrides.consentText();
      return { ok: true, json: async () => ({ text: SAMPLE_TEXT }) } as Response;
    }
    if (url === "/api/auth/consent" && init?.method === "PATCH") {
      if (overrides.consentPatch) return overrides.consentPatch();
      return { ok: true, json: async () => ({ dataConsentAccepted: true }) } as Response;
    }
    if (url === "/api/auth/logout" && init?.method === "POST") {
      return { ok: true, json: async () => ({}) } as Response;
    }
    throw new Error(`fetch no mockeado: ${url} ${init?.method ?? "GET"}`);
  });
}

function renderGate(initialAccepted = false, fetchImpl: ReturnType<typeof mockFetch> = mockFetch()) {
  vi.stubGlobal("fetch", fetchImpl);
  return render(
    <ToastProvider>
      <ConsentGate initialAccepted={initialAccepted}>
        <div>Contenido protegido</div>
      </ConsentGate>
    </ToastProvider>
  );
}

/** jsdom no calcula layout real — `scrollHeight`/`clientHeight` son 0 por
 * defecto, así que el chequeo de "¿entra todo sin scroll?" ya lo trataría
 * como cierto. Para probar el gating por scroll hay que stubear los
 * getters a nivel de prototipo, antes de montar. */
function stubOverflow(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

/** Espera a que el contenido real (ya no el esqueleto de carga) esté en
 * pantalla antes de tomar el contenedor con scroll — el gate por scroll
 * solo se evalúa una vez que el texto terminó de cargar. */
async function getScrollContainer() {
  let container: HTMLElement | null = null;
  await waitFor(() => {
    const inner = screen.getByText(SAMPLE_TEXT).closest("div");
    container = inner?.parentElement ?? null;
    expect(container).not.toBeNull();
  });
  return container as unknown as HTMLElement;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  push.mockReset();
  refresh.mockReset();
});

describe("ConsentGate", () => {
  it("con consentimiento ya aceptado, renderiza directo el contenido protegido (sin pedir el texto del aviso)", () => {
    const fetchImpl = mockFetch();
    renderGate(true, fetchImpl);
    expect(screen.getByText("Contenido protegido")).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sin consentimiento, muestra el modal con el texto real cargado y NO el contenido protegido", async () => {
    renderGate(false);
    expect(screen.getByText("Tratamiento de Datos Personales")).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });
  });

  it("si falla la carga del texto configurado, usa el respaldo hardcodeado en vez de dejar el modal vacío", async () => {
    renderGate(
      false,
      mockFetch({
        consentText: async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as Response,
      })
    );
    await waitFor(() => {
      expect(screen.getByText(/Nexo recopila y almacena/)).toBeInTheDocument();
    });
  });

  it("el botón Aceptar está deshabilitado hasta marcar el checkbox", async () => {
    renderGate(false);
    await waitFor(() => {
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });
    const button = screen.getByRole("button", { name: /Aceptar y continuar/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).not.toBeDisabled();
  });

  it("con texto que SÍ necesita scroll: marcar el checkbox no alcanza — hay que llegar al final", async () => {
    stubOverflow(1000, 300);
    renderGate(false);
    const container = await getScrollContainer();
    Object.defineProperty(container, "scrollTop", { configurable: true, value: 0, writable: true });

    const button = screen.getByRole("button", { name: /Aceptar y continuar/i });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeDisabled();
    expect(screen.getByText("Desplázate hasta el final del texto para poder aceptar.")).toBeInTheDocument();

    // Todavía no llegó al final -> sigue deshabilitado aunque haya scrolleado un poco.
    container.scrollTop = 500;
    fireEvent.scroll(container);
    expect(button).toBeDisabled();

    // Llega al final -> ahora sí se habilita (checkbox ya estaba marcado).
    container.scrollTop = 700; // 700 + 300 >= 1000 - 4
    fireEvent.scroll(container);
    expect(button).not.toBeDisabled();
    expect(screen.queryByText("Desplázate hasta el final del texto para poder aceptar.")).not.toBeInTheDocument();
  });

  it("con texto que SÍ necesita scroll: llegar al final sin marcar el checkbox tampoco alcanza", async () => {
    stubOverflow(1000, 300);
    renderGate(false);
    const container = await getScrollContainer();
    Object.defineProperty(container, "scrollTop", { configurable: true, value: 700, writable: true });
    fireEvent.scroll(container);

    const button = screen.getByRole("button", { name: /Aceptar y continuar/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).not.toBeDisabled();
  });

  it("PATCH exitoso: acepta y renderiza el contenido protegido", async () => {
    renderGate(false);
    await waitFor(() => {
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Aceptar y continuar/i }));

    await waitFor(() => expect(screen.getByText("Contenido protegido")).toBeInTheDocument());
  });

  it("PATCH con 401 en el primer intento pero éxito en el reintento: acepta igual", async () => {
    let calls = 0;
    renderGate(
      false,
      mockFetch({
        consentPatch: async () => {
          calls += 1;
          if (calls === 1) return { ok: false, status: 401, json: async () => ({ error: "no autenticado" }) } as Response;
          return { ok: true, json: async () => ({ dataConsentAccepted: true }) } as Response;
        },
      })
    );
    await waitFor(() => {
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Aceptar y continuar/i }));

    await waitFor(() => expect(screen.getByText("Contenido protegido")).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it("PATCH que sigue fallando: muestra el error real (antes: fallaba en silencio) y NO avanza", async () => {
    renderGate(
      false,
      mockFetch({
        consentPatch: async () =>
          ({ ok: false, status: 400, json: async () => ({ error: "No se pudo registrar el consentimiento" }) }) as Response,
      })
    );
    await waitFor(() => {
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Aceptar y continuar/i }));

    await waitFor(() => {
      expect(screen.getByText("No se pudo registrar el consentimiento")).toBeInTheDocument();
    });
    // Sigue bloqueado: el contenido protegido nunca se renderiza.
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
    expect(screen.getByText("Tratamiento de Datos Personales")).toBeInTheDocument();
  });

  it("error de red al aceptar (fetch rechaza): muestra un mensaje de error de conexión", async () => {
    renderGate(
      false,
      mockFetch({
        consentPatch: async () => {
          throw new Error("network down");
        },
      })
    );
    await waitFor(() => {
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Aceptar y continuar/i }));

    await waitFor(() => {
      expect(screen.getByText("Error de conexión. Intenta de nuevo.")).toBeInTheDocument();
    });
  });

  it("Rechazar y salir: cierra sesión y redirige a /login con el flag de rechazo", async () => {
    renderGate(false);
    fireEvent.click(screen.getByRole("button", { name: /Rechazar y salir/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?consentRejected=1"));
    expect(refresh).toHaveBeenCalled();
  });
});
