import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DocumentationSection from "@/components/settings/DocumentationSection";

// Hallazgo de la auditoría de seguridad (ver docs/AUDIT_LOG.md § 2026-09-01,
// NEXO-03): `marked` no sanitiza HTML crudo embebido en el Markdown fuente.
// Este test prueba exactamente ese escenario — contenido con un <script>
// crudo, como si un .md commiteado citara texto sin escapar — y confirma
// que DOMPurify lo elimina antes de llegar al DOM.
beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentationSection", () => {
  it("sanitiza HTML crudo embebido en el Markdown antes de renderizarlo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          content: "<script>window.__xss = true;</script>\n\n# Título de prueba\n\nTexto normal.",
          updatedAt: "2026-09-01T00:00:00Z",
        }),
      }))
    );

    const { container } = render(<DocumentationSection />);

    await waitFor(() => expect(screen.getByText("Título de prueba")).toBeInTheDocument());

    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
    expect(screen.getByText("Texto normal.")).toBeInTheDocument();
  });
});
