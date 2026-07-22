import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Role } from "@/generated/prisma/client";

const { default: MyKpisModule } = await import("@/components/kpis/MyKpisModule");

const LEADERSHIP_MESSAGE = /funciones principalmente de supervisión y dirección/;

function renderModule(role: Role) {
  return render(
    <MyKpisModule currentUserId="u1" currentUserName="Ana Coordinadora" currentUserRole={role} />
  );
}

describe("MyKpisModule — Analytics personal según jerarquía (Sprint 0A)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Coordinador Nacional (rol de gestión) SÍ ve su panel de Analytics personal, no el mensaje de liderazgo", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "mock" }) } as Response));
    vi.stubGlobal("fetch", fetchMock);

    renderModule("COORDINADOR_NACIONAL" as Role);

    // El header y el selector de modo se renderizan siempre que se pase el
    // early-return de liderazgo, independientemente de si /api/kpis/me ya resolvió.
    expect(await screen.findByText("Mes individual")).toBeInTheDocument();
    expect(screen.getByText("Rango personalizado")).toBeInTheDocument();
    expect(screen.queryByText(LEADERSHIP_MESSAGE)).not.toBeInTheDocument();

    // Confirma que sí intenta calcular KPIs personales (no se salta el fetch).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/kpis/me")));
  });

  it("Jefe Nacional NO ve el panel personal — solo el mensaje explicativo, sin pedir /api/kpis/me", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "mock" }) } as Response));
    vi.stubGlobal("fetch", fetchMock);

    renderModule("JEFE_NACIONAL" as Role);

    expect(await screen.findByText(LEADERSHIP_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Mes individual")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Administrador NO ve el panel personal — solo el mensaje explicativo, sin pedir /api/kpis/me", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "mock" }) } as Response));
    vi.stubGlobal("fetch", fetchMock);

    renderModule("ADMINISTRADOR" as Role);

    expect(await screen.findByText(LEADERSHIP_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Mes individual")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
