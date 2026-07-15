import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";

describe("Card composition", () => {
  it("compone Card + CardHeader + CardTitle + CardBody con su contenido", () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Título</CardTitle>
        </CardHeader>
        <CardBody>Contenido del cuerpo</CardBody>
      </Card>
    );

    expect(screen.getByTestId("card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Título" })).toBeInTheDocument();
    expect(screen.getByText("Contenido del cuerpo")).toBeInTheDocument();
  });

  it("Card aplica sus clases base y conserva un className adicional", () => {
    render(
      <Card data-testid="card" className="mt-4">
        contenido
      </Card>
    );
    expect(screen.getByTestId("card")).toHaveClass("bg-surface", "rounded-[14px]", "mt-4");
  });

  it("CardTitle renderiza un <h2>", () => {
    render(<CardTitle>Encabezado</CardTitle>);
    const heading = screen.getByRole("heading", { level: 2, name: "Encabezado" });
    expect(heading).toBeInTheDocument();
  });

  it("CardHeader y CardBody aceptan className adicional sin perder sus clases base", () => {
    render(
      <>
        <CardHeader data-testid="header" className="extra-header">
          h
        </CardHeader>
        <CardBody data-testid="body" className="extra-body">
          b
        </CardBody>
      </>
    );
    expect(screen.getByTestId("header")).toHaveClass("border-b", "extra-header");
    expect(screen.getByTestId("body")).toHaveClass("px-5", "extra-body");
  });
});
