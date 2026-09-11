import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import PasswordManagementSection from "@/components/settings/PasswordManagementSection";

// Desde 2026-09-11 esta sección entrega un enlace de recuperación en vez de
// solo marcar que la persona debe cambiar su contraseña (ver
// docs/AUDIT_LOG.md § 2026-09-11). Lo que se verifica acá es que el enlace
// llegue a la pantalla y que se advierta lo que implica: es de un solo uso,
// vence, y mientras tanto permite entrar a esa cuenta.

const USERS = [{ id: "7", name: "Ana Pérez", role: "ASISTENTE_GH" as const }];
const ENLACE = "http://10.0.2.33:4080/reset-password?token=token-de-prueba";

function renderSection(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchImpl);
  return render(
    <ToastProvider>
      <PasswordManagementSection users={USERS} loading={false} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

function respuestaConEnlace() {
  return vi.fn(async () =>
    ({
      ok: true,
      json: async () => ({ ok: true, resetUrl: ENLACE, userName: "Ana Pérez" }),
    }) as Response
  );
}

describe("PasswordManagementSection", () => {
  it("no muestra ningún enlace antes de pedirlo", () => {
    renderSection(respuestaConEnlace());
    expect(screen.queryByText(/reset-password\?token=/)).not.toBeInTheDocument();
  });

  it("muestra el enlace generado, con la advertencia de lo que implica", async () => {
    const fetchMock = respuestaConEnlace();
    renderSection(fetchMock);

    fireEvent.click(screen.getByText(/Generar enlace de recuperación/));

    expect(await screen.findByText(ENLACE)).toBeInTheDocument();
    expect(screen.getByText(/Enlace de recuperación para Ana Pérez/)).toBeInTheDocument();
    // La advertencia no es decorativa: el enlace equivale a poder entrar a
    // esa cuenta mientras esté vigente. Se busca el párrafo contenedor
    // porque "una sola vez" está dentro de un <strong>.
    const aviso = screen.getByText(/una sola vez/i).closest("p")!;
    expect(aviso).toHaveTextContent(/60 minutos/);
    expect(aviso).toHaveTextContent(/sesiones abiertas ya se cerraron/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/users/7/reset-password", { method: "POST" });
  });

  it("copia el enlace al portapapeles y lo confirma", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderSection(respuestaConEnlace());

    fireEvent.click(screen.getByText(/Generar enlace de recuperación/));
    fireEvent.click(await screen.findByRole("button", { name: "Copiar" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENLACE));
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("si el backend falla, muestra su mensaje y no inventa un enlace", async () => {
    const fetchMock = vi.fn(async () =>
      ({ ok: false, json: async () => ({ error: "Sin permisos" }) }) as Response
    );
    renderSection(fetchMock);

    fireEvent.click(screen.getByText(/Generar enlace de recuperación/));

    expect(await screen.findByText("Sin permisos")).toBeInTheDocument();
    expect(screen.queryByText(/reset-password\?token=/)).not.toBeInTheDocument();
  });

  it("permite cerrar el enlace para que no quede a la vista", async () => {
    renderSection(respuestaConEnlace());

    fireEvent.click(screen.getByText(/Generar enlace de recuperación/));
    expect(await screen.findByText(ENLACE)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cerrar"));

    await waitFor(() => expect(screen.queryByText(ENLACE)).not.toBeInTheDocument());
  });
});
