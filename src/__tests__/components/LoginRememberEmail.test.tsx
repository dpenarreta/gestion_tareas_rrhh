import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => searchParams,
}));

const { default: LoginPage } = await import("@/app/login/page");

const CLAVE = "nexo-correo-recordado";

function loginExitoso() {
  return vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  ) as unknown as typeof fetch;
}

async function enviarLogin({ recordar }: { recordar: boolean }) {
  fireEvent.change(screen.getByPlaceholderText("usuario@empresa.com"), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("••••••"), {
    target: { value: "Sup3r-Secr3t!" },
  });
  if (recordar) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /ingresar/i }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
}

describe("Login — recordar el correo", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    localStorage.clear();
    push.mockClear();
    global.fetch = loginExitoso();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("guarda el correo al marcar la casilla", async () => {
    render(<LoginPage />);
    await enviarLogin({ recordar: true });

    const guardado = JSON.parse(localStorage.getItem(CLAVE)!);
    expect(guardado.email).toBe("ada@example.com");
    expect(guardado.expira).toBeGreaterThan(Date.now());
  });

  it("nunca guarda la contraseña", async () => {
    render(<LoginPage />);
    await enviarLogin({ recordar: true });

    // El punto entero de la decisión: la comodidad la da el gestor del
    // navegador vía autocomplete, no un secreto guardado por Nexo.
    expect(JSON.stringify(localStorage)).not.toContain("Sup3r-Secr3t!");
  });

  it("no guarda nada si la casilla queda sin marcar", async () => {
    render(<LoginPage />);
    await enviarLogin({ recordar: false });

    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it("precompleta el correo recordado y deja la casilla marcada", async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ email: "ada@example.com", expira: Date.now() + 86400000 })
    );

    render(<LoginPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("usuario@empresa.com")).toHaveValue("ada@example.com")
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("olvida el correo vencido en vez de precompletarlo", async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ email: "ada@example.com", expira: Date.now() - 1000 })
    );

    render(<LoginPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("usuario@empresa.com")).toHaveValue("")
    );
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it("los campos permiten que el gestor del navegador complete la contraseña", () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText("usuario@empresa.com")).toHaveAttribute(
      "autocomplete",
      "username"
    );
    expect(screen.getByPlaceholderText("••••••")).toHaveAttribute(
      "autocomplete",
      "current-password"
    );
  });

  it("la casilla ya no alarga la sesión: no se manda rememberMe", async () => {
    render(<LoginPage />);
    await enviarLogin({ recordar: true });

    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      email: "ada@example.com",
      password: "Sup3r-Secr3t!",
    });
  });
});
