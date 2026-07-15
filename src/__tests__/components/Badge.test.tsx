import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/Badge";

describe("Badge", () => {
  it("renderiza su contenido", () => {
    render(<Badge>Activo</Badge>);
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("usa la variante 'neutral' por defecto", () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText("Default")).toHaveClass("bg-surface2", "text-secondary");
  });

  it("aplica las clases correspondientes a cada variante", () => {
    const { rerender } = render(<Badge variant="success">Ok</Badge>);
    expect(screen.getByText("Ok")).toHaveClass("bg-success/[.13]", "text-success");

    rerender(<Badge variant="danger">Error</Badge>);
    expect(screen.getByText("Error")).toHaveClass("bg-danger/[.13]", "text-danger");

    rerender(<Badge variant="warning">Alerta</Badge>);
    expect(screen.getByText("Alerta")).toHaveClass("bg-warning/[.15]", "text-warning");

    rerender(<Badge variant="nova">Nova</Badge>);
    expect(screen.getByText("Nova")).toHaveClass("bg-nova-soft", "text-nova");
  });

  it("combina el className extra con las clases de la variante, sin reemplazarlas", () => {
    render(<Badge className="ml-2">Con extra</Badge>);
    const el = screen.getByText("Con extra");
    expect(el).toHaveClass("ml-2", "bg-surface2");
  });

  it("pasa el resto de props HTML al elemento span (ej. title, data-testid)", () => {
    render(
      <Badge title="tooltip" data-testid="my-badge">
        Con props
      </Badge>
    );
    const el = screen.getByTestId("my-badge");
    expect(el).toHaveAttribute("title", "tooltip");
    expect(el.tagName).toBe("SPAN");
  });
});
