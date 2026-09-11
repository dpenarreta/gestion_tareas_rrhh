import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Bug real en producción (ver docs/AUDIT_LOG.md § 2026-09-11): el botón
 * "Copiar" del enlace de recuperación no copiaba nada.
 *
 * `navigator.clipboard` solo existe en contextos seguros (https o
 * localhost), y Nexo se sirve por http en la red interna — o sea que en
 * producción esa API es `undefined` y el camino moderno NUNCA está
 * disponible. El caso que hay que cubrir es justamente ese, no el feliz.
 */

const execCommand = vi.fn(() => true);

beforeEach(() => {
  execCommand.mockClear().mockReturnValue(true);
  // jsdom no implementa execCommand; se agrega para poder observarlo.
  (document as unknown as { execCommand: unknown }).execCommand = execCommand;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyToClipboard", () => {
  it("usa la API moderna cuando está disponible (https o localhost)", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    expect(await copyToClipboard("texto")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("texto");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("copia igual sirviendo por http, donde navigator.clipboard no existe", async () => {
    // El escenario de producción.
    vi.stubGlobal("navigator", {});

    expect(await copyToClipboard("http://10.0.2.33:4080/reset-password?token=x")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("cae al método alternativo si la API moderna existe pero es rechazada", async () => {
    // Pasa con el permiso denegado o el documento sin foco.
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    expect(await copyToClipboard("texto")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("devuelve false en vez de lanzar cuando no se puede copiar de ninguna forma", async () => {
    // Quien llama decide qué mostrar; el texto siempre queda visible para
    // seleccionarlo a mano.
    vi.stubGlobal("navigator", {});
    execCommand.mockReturnValue(false);

    expect(await copyToClipboard("texto")).toBe(false);
  });

  it("no deja basura en el DOM después de copiar", async () => {
    vi.stubGlobal("navigator", {});
    const antes = document.body.children.length;

    await copyToClipboard("texto");

    expect(document.body.children.length).toBe(antes);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("tampoco deja basura si el copiado falla", async () => {
    vi.stubGlobal("navigator", {});
    execCommand.mockImplementation(() => {
      throw new Error("execCommand no soportado");
    });
    const antes = document.body.children.length;

    expect(await copyToClipboard("texto")).toBe(false);
    expect(document.body.children.length).toBe(antes);
  });
});
