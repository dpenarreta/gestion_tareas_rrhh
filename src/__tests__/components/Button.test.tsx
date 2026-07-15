import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("renderiza sus hijos como texto del botón", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });

  it("usa la variante 'primary' por defecto", () => {
    render(<Button>Primario</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-primary", "text-white");
  });

  it("aplica las clases de cada variante", () => {
    const { rerender } = render(<Button variant="secondary">Sec</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-surface", "border-border2");

    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button")).toHaveClass("text-secondary");

    rerender(<Button variant="destructive">Borrar</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-danger");
  });

  it("dispara onClick al hacer clic", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("no dispara onClick cuando está deshabilitado", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Deshabilitado
      </Button>
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("combina className adicional con las clases de variante", () => {
    render(<Button className="w-full">Ancho</Button>);
    expect(screen.getByRole("button")).toHaveClass("w-full", "bg-primary");
  });

  it("pasa atributos HTML nativos (type, aria-label)", () => {
    render(
      <Button type="submit" aria-label="enviar formulario">
        Enviar
      </Button>
    );
    const btn = screen.getByRole("button", { name: "enviar formulario" });
    expect(btn).toHaveAttribute("type", "submit");
  });
});
