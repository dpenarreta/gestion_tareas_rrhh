import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/mask-email";

describe("maskEmail", () => {
  it("enmascara la parte local y la etiqueta del dominio, preservando la extensión", () => {
    expect(maskEmail("john@example.com")).toBe("j***@e*****.com");
  });

  it("deja sin cambios las partes de un solo carácter (local o dominio)", () => {
    expect(maskEmail("a@b.com")).toBe("a@b.com");
  });

  it("limita el relleno de asteriscos a un máximo de 5, incluso para partes muy largas", () => {
    expect(maskEmail("averyveryverylongname@averyverylongdomain.com")).toBe("a*****@a*****.com");
  });

  it("maneja un dominio sin punto (sin extensión)", () => {
    expect(maskEmail("user@localhost")).toBe("u***@l*****");
  });

  it("devuelve el valor sin cambios si no contiene '@'", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });

  it("conserva el resto del dominio a partir del primer punto (subdominios)", () => {
    expect(maskEmail("ana@mail.corp.com")).toBe("a**@m***.corp.com");
  });
});
