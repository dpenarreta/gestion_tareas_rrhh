import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

const { default: Sidebar } = await import("@/components/shell/Sidebar");

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const onToggleCollapsed = vi.fn();
  const onCloseMobile = vi.fn();
  const utils = render(
    <Sidebar
      role="ASISTENTE_GH"
      collapsed={false}
      onToggleCollapsed={onToggleCollapsed}
      mobileOpen={false}
      onCloseMobile={onCloseMobile}
      {...overrides}
    />
  );
  return { ...utils, onToggleCollapsed, onCloseMobile };
}

describe("Sidebar", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/dashboard");
  });

  it("un rol de nivel 1 (ASISTENTE_GH) ve 'Mi actividad' pero no 'Equipo' ni 'Usuarios'", () => {
    renderSidebar({ role: "ASISTENTE_GH" });
    expect(screen.getByText("Mi actividad")).toBeInTheDocument();
    expect(screen.queryByText("Equipo")).not.toBeInTheDocument();
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
  });

  it("un rol con gestión de usuarios (JEFE_NACIONAL) ve 'Equipo', 'Analytics' y 'Usuarios'", () => {
    renderSidebar({ role: "JEFE_NACIONAL" });
    expect(screen.getByText("Equipo")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Usuarios")).toBeInTheDocument();
  });

  it("solo ADMINISTRADOR ve el enlace de Ajustes", () => {
    renderSidebar({ role: "ADMINISTRADOR" });
    expect(screen.getByText("Ajustes")).toBeInTheDocument();
  });

  it("JEFE_NACIONAL no ve el enlace 'Trabajo' (no gestiona tareas propias)", () => {
    renderSidebar({ role: "JEFE_NACIONAL" });
    expect(screen.queryByText("Trabajo")).not.toBeInTheDocument();
  });

  it("otros roles con equipo (COORDINADOR_NACIONAL) sí ven 'Trabajo'", () => {
    renderSidebar({ role: "COORDINADOR_NACIONAL" });
    expect(screen.getByText("Trabajo")).toBeInTheDocument();
  });

  it("marca como activo el enlace cuya href coincide con el pathname actual", () => {
    usePathname.mockReturnValue("/tasks");
    renderSidebar({ role: "ASISTENTE_GH" });
    const trabajoLink = screen.getByText("Trabajo").closest("a");
    expect(trabajoLink).toHaveClass("text-primary");
  });

  it("marca como activo el enlace para una subruta del pathname actual", () => {
    usePathname.mockReturnValue("/tasks/123/details");
    renderSidebar({ role: "ASISTENTE_GH" });
    const trabajoLink = screen.getByText("Trabajo").closest("a");
    expect(trabajoLink).toHaveClass("text-primary");
  });

  it("no marca como activo un enlace que no coincide con el pathname", () => {
    usePathname.mockReturnValue("/tasks");
    renderSidebar({ role: "ASISTENTE_GH" });
    const inicioLink = screen.getByText("Inicio").closest("a");
    expect(inicioLink).not.toHaveClass("text-primary");
  });

  it("al hacer clic en un enlace de navegación, cierra el menú móvil (onCloseMobile)", () => {
    const { onCloseMobile } = renderSidebar({ role: "ASISTENTE_GH", mobileOpen: true });
    fireEvent.click(screen.getByText("Inicio"));
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  it("al hacer clic en el botón de colapsar, llama a onToggleCollapsed", () => {
    const { onToggleCollapsed } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /menú/i }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("muestra el overlay móvil solo cuando mobileOpen=true, y al hacer clic cierra el menú", () => {
    const { container, onCloseMobile, rerender } = renderSidebar({ mobileOpen: false });
    expect(container.querySelector(".bg-black\\/50")).not.toBeInTheDocument();

    rerender(
      <Sidebar
        role="ASISTENTE_GH"
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mobileOpen
        onCloseMobile={onCloseMobile}
      />
    );
    const overlay = container.querySelector(".bg-black\\/50");
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay!);
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });
});
