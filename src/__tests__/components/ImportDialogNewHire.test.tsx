import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import ImportDialog from "@/components/novedades/ImportDialog";

// Columna NUEVO INGRESO de la importación de la base (ver docs/CHANGELOG.md
// § v1.179.0): la vista previa informa cuántas altas vienen marcadas con X y
// avisa cuando la X está en alguien que ya existe.

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("ImportDialog — base de colaboradores", () => {
  it("explica la columna y muestra los nuevos ingresos marcados y los avisos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(201, {
          id: 4,
          kind: "COLLABORATORS",
          status: "PREVIEW",
          fileName: "base.xlsx",
          rows: [],
          errors: [],
          summary: {
            totalRows: 3,
            newItems: 2,
            existingItems: 1,
            toUpdate: 0,
            duplicatesInFile: 0,
            invalidRows: 0,
            validRows: 3,
            newHires: 2,
            warnings: [{ row: 4, column: "NUEVO INGRESO", message: "Beto ya existe en la base: la marca de nuevo ingreso no cambia su clasificación." }],
          },
        }),
      ),
    );
    render(
      <ToastProvider>
        <ImportDialog kind="COLLABORATORS" supervisorId={6} supervisorName="Sup Norte" onClose={vi.fn()} onImported={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.getByText(/NUEVO INGRESO \(X si es un nuevo ingreso, vacía si no/)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "base.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    const card = (await screen.findByText("Nuevos ingresos (X)")).parentElement!;
    expect(card).toHaveTextContent("2");
    expect(screen.getByText(/la marca de nuevo ingreso no cambia su clasificación/)).toBeInTheDocument();
  });
});
