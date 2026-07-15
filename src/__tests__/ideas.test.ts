import { describe, expect, it } from "vitest";
import { nextIdeaStatus, prevIdeaStatus, canReject, IDEA_STATUS_ORDER } from "@/lib/ideas";
import type { IdeaStatus } from "@/generated/prisma/client";

describe("nextIdeaStatus", () => {
  it("avanza cada estado del flujo al siguiente en orden", () => {
    expect(nextIdeaStatus("PROPUESTA")).toBe("EN_REVISION");
    expect(nextIdeaStatus("EN_REVISION")).toBe("APROBADA");
    expect(nextIdeaStatus("APROBADA")).toBe("EN_DESARROLLO");
    expect(nextIdeaStatus("EN_DESARROLLO")).toBe("EN_PRUEBAS");
    expect(nextIdeaStatus("EN_PRUEBAS")).toBe("IMPLEMENTADA");
  });

  it("no se puede avanzar desde el último estado del flujo (IMPLEMENTADA)", () => {
    expect(nextIdeaStatus("IMPLEMENTADA")).toBeNull();
  });

  it("no se puede avanzar desde RECHAZADA (fuera del orden del flujo)", () => {
    expect(nextIdeaStatus("RECHAZADA")).toBeNull();
  });
});

describe("prevIdeaStatus", () => {
  it("retrocede cada estado del flujo al anterior en orden", () => {
    expect(prevIdeaStatus("EN_REVISION")).toBe("PROPUESTA");
    expect(prevIdeaStatus("APROBADA")).toBe("EN_REVISION");
    expect(prevIdeaStatus("EN_DESARROLLO")).toBe("APROBADA");
    expect(prevIdeaStatus("EN_PRUEBAS")).toBe("EN_DESARROLLO");
    expect(prevIdeaStatus("IMPLEMENTADA")).toBe("EN_PRUEBAS");
  });

  it("no se puede retroceder desde el primer estado del flujo (PROPUESTA)", () => {
    expect(prevIdeaStatus("PROPUESTA")).toBeNull();
  });

  it("no se puede retroceder desde RECHAZADA (fuera del orden del flujo)", () => {
    expect(prevIdeaStatus("RECHAZADA")).toBeNull();
  });
});

describe("canReject", () => {
  it("se puede rechazar desde cualquier estado del flujo activo", () => {
    for (const status of IDEA_STATUS_ORDER.filter((s) => s !== "IMPLEMENTADA")) {
      expect(canReject(status)).toBe(true);
    }
  });

  it("no se puede rechazar una idea ya implementada", () => {
    expect(canReject("IMPLEMENTADA")).toBe(false);
  });

  it("no se puede rechazar una idea que ya está rechazada", () => {
    expect(canReject("RECHAZADA")).toBe(false);
  });
});

describe("IDEA_STATUS_ORDER", () => {
  it("define el orden completo del flujo, sin duplicados, terminando en IMPLEMENTADA", () => {
    const expected: IdeaStatus[] = ["PROPUESTA", "EN_REVISION", "APROBADA", "EN_DESARROLLO", "EN_PRUEBAS", "IMPLEMENTADA"];
    expect(IDEA_STATUS_ORDER).toEqual(expected);
    expect(new Set(IDEA_STATUS_ORDER).size).toBe(IDEA_STATUS_ORDER.length);
  });
});
