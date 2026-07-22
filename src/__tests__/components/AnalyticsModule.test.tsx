import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Role } from "@/generated/prisma/client";

vi.mock("@/components/kpis/ExecutiveDashboard", () => ({
  default: () => <div data-testid="executive-dashboard">executive</div>,
}));
vi.mock("@/components/kpis/KpisModule", () => ({
  default: () => <div data-testid="team-module">team</div>,
}));
vi.mock("@/components/kpis/MyKpisModule", () => ({
  default: () => <div data-testid="personal-module">personal</div>,
}));

const { default: AnalyticsModule } = await import("@/components/kpis/AnalyticsModule");

function renderAnalytics(role: Role) {
  return render(
    <AnalyticsModule currentUserId="u1" currentUserRole={role} currentUserName="Marco Caguana" />
  );
}

describe("AnalyticsModule — pestaña 'Mi actividad' no existe para roles de dirección", () => {
  it("Jefe Nacional no ve el botón 'Mi actividad' y abre directamente en Resumen ejecutivo", () => {
    renderAnalytics("JEFE_NACIONAL" as Role);
    expect(screen.queryByText("Mi actividad")).not.toBeInTheDocument();
    expect(screen.getByTestId("executive-dashboard")).toBeInTheDocument();
  });

  it("Administrador no ve el botón 'Mi actividad' y abre directamente en Resumen ejecutivo", () => {
    renderAnalytics("ADMINISTRADOR" as Role);
    expect(screen.queryByText("Mi actividad")).not.toBeInTheDocument();
    expect(screen.getByTestId("executive-dashboard")).toBeInTheDocument();
  });

  it("Coordinador Nacional (rol de gestión) sigue viendo y pudiendo abrir 'Mi actividad'", () => {
    renderAnalytics("COORDINADOR_NACIONAL" as Role);
    const btn = screen.getByText("Mi actividad");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByTestId("personal-module")).toBeInTheDocument();
  });

  it("un rol operativo de nivel 1 (sin Equipo/Ejecutivo) abre directamente en 'Mi actividad'", () => {
    renderAnalytics("ASISTENTE_GH" as Role);
    expect(screen.queryByText("Resumen ejecutivo")).not.toBeInTheDocument();
    expect(screen.queryByText("Equipo")).not.toBeInTheDocument();
    expect(screen.getByText("Mi actividad")).toBeInTheDocument();
    expect(screen.getByTestId("personal-module")).toBeInTheDocument();
  });

  it("Coordinador ZS (nivel 2, sin resumen ejecutivo) ve Equipo y Mi actividad", () => {
    renderAnalytics("COORDINADOR_ZS" as Role);
    expect(screen.queryByText("Resumen ejecutivo")).not.toBeInTheDocument();
    expect(screen.getByText("Equipo")).toBeInTheDocument();
    expect(screen.getByText("Mi actividad")).toBeInTheDocument();
    expect(screen.getByTestId("team-module")).toBeInTheDocument();
  });
});
