import { describe, expect, it } from "vitest";
import { hasPermission, hasAnyPermission, canManageRoles, canViewRoles } from "@/lib/permissions";

describe("hasPermission", () => {
  it("true si el codename está en la lista", () => {
    expect(hasPermission(["usuarios.ver", "roles.ver"], "roles.ver")).toBe(true);
  });

  it("false si no está", () => {
    expect(hasPermission(["usuarios.ver"], "roles.ver")).toBe(false);
  });

  it("false con lista vacía", () => {
    expect(hasPermission([], "roles.ver")).toBe(false);
  });
});

describe("hasAnyPermission", () => {
  it("true si al menos uno de los codenames está presente", () => {
    expect(hasAnyPermission(["reportes.ver"], ["equipo.ver", "reportes.ver"])).toBe(true);
  });

  it("false si ninguno está presente", () => {
    expect(hasAnyPermission(["reportes.ver"], ["equipo.ver", "proyectos.crear"])).toBe(false);
  });

  it("false con lista de codenames requeridos vacía", () => {
    expect(hasAnyPermission(["reportes.ver"], [])).toBe(false);
  });
});

describe("canManageRoles", () => {
  it("true con roles.editar", () => {
    expect(canManageRoles(["roles.editar"])).toBe(true);
  });

  it("false solo con roles.ver", () => {
    expect(canManageRoles(["roles.ver"])).toBe(false);
  });
});

describe("canViewRoles", () => {
  it("true con roles.ver", () => {
    expect(canViewRoles(["roles.ver"])).toBe(true);
  });

  it("false sin roles.ver", () => {
    expect(canViewRoles([])).toBe(false);
  });
});
