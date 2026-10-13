import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceErrorFallback } from "@/components/ui/ServiceErrorFallback";

// Error de renderizado de un Server Component (p. ej. Django detenido): se
// muestra un mensaje controlado, sin la traza técnica, con opción de reintentar.

describe("ServiceErrorFallback", () => {
  it("muestra un mensaje controlado, la referencia y reintenta", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8000"), { digest: "123abc" });
    render(<ServiceErrorFallback error={error} retry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar esta sección");
    expect(screen.getByText(/no está disponible temporalmente/)).toBeInTheDocument();
    expect(screen.getByText("Referencia: 123abc")).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument(); // sin detalle técnico
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
