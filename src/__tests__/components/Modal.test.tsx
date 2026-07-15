import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal, ModalHeader } from "@/components/ui/Modal";

describe("Modal", () => {
  it("no renderiza nada cuando open=false", () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()}>
        contenido
      </Modal>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renderiza su contenido cuando open=true", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>contenido del modal</p>
      </Modal>
    );
    expect(screen.getByText("contenido del modal")).toBeInTheDocument();
  });

  it("llama a onClose al hacer clic en el overlay (variante 'center')", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose}>
        contenido
      </Modal>
    );
    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("llama a onClose al hacer clic en el overlay (variante 'drawer')", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose} variant="drawer">
        contenido
      </Modal>
    );
    const overlay = container.querySelector('[aria-hidden="true"]');
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aplica la clase de ancho máximo correspondiente al tamaño (sm/md/lg)", () => {
    const { container, rerender } = render(
      <Modal open onClose={vi.fn()} size="sm">
        c
      </Modal>
    );
    expect(container.querySelector(".max-w-sm")).not.toBeNull();

    rerender(
      <Modal open onClose={vi.fn()} size="lg">
        c
      </Modal>
    );
    expect(container.querySelector(".max-w-2xl")).not.toBeNull();
  });
});

describe("ModalHeader", () => {
  it("renderiza el título dado", () => {
    render(<ModalHeader title="Editar tarea" onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Editar tarea" })).toBeInTheDocument();
  });

  it("llama a onClose al hacer clic en el botón de cerrar", () => {
    const onClose = vi.fn();
    render(<ModalHeader title="Título" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
