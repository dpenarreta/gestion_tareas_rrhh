import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PasswordChangeGate from "@/components/PasswordChangeGate";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * Bug real en producción (ver docs/AUDIT_LOG.md § 2026-09-11): Django
 * responde 403 `password_change_required` a toda ruta salvo cuatro mientras
 * `must_change_password` esté activo, y el frontend lo ignoraba por
 * completo. Quien recibía un restablecimiento entraba, veía el menú, y
 * todas las pantallas quedaban vacías sin explicación ni forma de salir.
 */

const onLogout = vi.fn(async () => {});

beforeEach(() => {
  refresh.mockClear();
  onLogout.mockClear();
  vi.unstubAllGlobals();
});

function renderGate(mustChange: boolean) {
  return render(
    <PasswordChangeGate mustChange={mustChange} onLogout={onLogout}>
      <p>contenido de la aplicación</p>
    </PasswordChangeGate>
  );
}

describe("PasswordChangeGate", () => {
  it("deja pasar cuando no hay cambio pendiente", () => {
    renderGate(false);
    expect(screen.getByText("contenido de la aplicación")).toBeInTheDocument();
  });

  it("bloquea la aplicación cuando el cambio es obligatorio", () => {
    renderGate(true);
    // Lo importante: el resto NO se renderiza, para no disparar llamadas
    // que Django respondería 403 igual.
    expect(screen.queryByText("contenido de la aplicación")).not.toBeInTheDocument();
    expect(screen.getByText(/Definí una contraseña nueva/i)).toBeInTheDocument();
  });

  it("explica por qué está bloqueado, en vez de dejar pantallas vacías", () => {
    renderGate(true);
    expect(screen.getByText(/fue restablecida/i)).toBeInTheDocument();
  });

  it("no envía nada si la confirmación no coincide", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderGate(true);

    fireEvent.change(screen.getByLabelText("Contraseña actual"), { target: { value: "vieja" } });
    fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: "Nueva-2026!" } });
    fireEvent.change(screen.getByLabelText(/Repetí la contraseña/i), { target: { value: "otra" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no coinciden/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("al cambiarla, libera la aplicación y refresca los datos del servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as Response)
    );
    renderGate(true);

    fireEvent.change(screen.getByLabelText("Contraseña actual"), { target: { value: "vieja" } });
    fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: "Nueva-2026!" } });
    fireEvent.change(screen.getByLabelText(/Repetí la contraseña/i), { target: { value: "Nueva-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(await screen.findByText("contenido de la aplicación")).toBeInTheDocument();
    // El layout ya se renderizó con el valor viejo: sin refresh, el resto de
    // la aplicación seguiría creyendo que hay un cambio pendiente.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("muestra el motivo del backend y sigue bloqueando si el cambio falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({ ok: false, json: async () => ({ error: "Contraseña actual incorrecta" }) }) as Response
      )
    );
    renderGate(true);

    fireEvent.change(screen.getByLabelText("Contraseña actual"), { target: { value: "mala" } });
    fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: "Nueva-2026!" } });
    fireEvent.change(screen.getByLabelText(/Repetí la contraseña/i), { target: { value: "Nueva-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña actual incorrecta");
    expect(screen.queryByText("contenido de la aplicación")).not.toBeInTheDocument();
  });

  it("ofrece cerrar sesión, única salida para quien no recuerda su contraseña actual", () => {
    renderGate(true);
    // Sin esto, quien no la sepa queda encerrado en el modal sin poder
    // siquiera volver al login.
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });
});
