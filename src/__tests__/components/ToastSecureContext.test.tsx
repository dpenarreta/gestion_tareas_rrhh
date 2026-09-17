import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { ToastProvider, useToast } = await import("@/components/ui/Toast");

/** Consumidor que imita el patrón real: avisar y DESPUÉS seguir trabajando. */
function Pantalla({ alTerminar }: { alTerminar: () => void }) {
  const { showToast } = useToast();
  return (
    <button
      onClick={() => {
        showToast("Tarea creada.", "success");
        // En la app esto es cerrar el modal y refrescar la lista. Si
        // `showToast` lanza, nada de esto ocurre.
        alTerminar();
      }}
    >
      Crear tarea
    </button>
  );
}

describe("Toast — servido por http, sin contexto seguro", () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  });

  function sinRandomUUID() {
    // Lo que el navegador realmente expone por http: `crypto` existe, pero
    // `randomUUID` no. Producción se sirve así (ver src/lib/httpsPolicy.ts).
    Object.defineProperty(globalThis, "crypto", {
      value: { ...original, randomUUID: undefined },
      configurable: true,
    });
  }

  it("no rompe el flujo de quien lo llama", () => {
    sinRandomUUID();
    const alTerminar = vi.fn();

    render(
      <ToastProvider>
        <Pantalla alTerminar={alTerminar} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /crear tarea/i }));

    // Regresión: `crypto.randomUUID is not a function` cortaba acá, el modal
    // no se cerraba y la lista no se refrescaba, así que la gente pulsaba de
    // nuevo y duplicaba la tarea.
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Tarea creada.")).toBeDefined();
  });

  it("varios toasts seguidos no comparten id", () => {
    sinRandomUUID();

    render(
      <ToastProvider>
        <Pantalla alTerminar={() => {}} />
      </ToastProvider>
    );

    const boton = screen.getByRole("button", { name: /crear tarea/i });
    act(() => {
      fireEvent.click(boton);
      fireEvent.click(boton);
      fireEvent.click(boton);
    });

    // Con ids repetidos React colapsaría las keys y se perdería alguno.
    expect(screen.getAllByText("Tarea creada.")).toHaveLength(3);
  });
});
