import { describe, expect, it } from "vitest";
import {
  hasPermission,
  hasAnyPermission,
  canManageRoles,
  canViewRoles,
  sessionPermissionsFor,
} from "@/lib/permissions";

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

  it("true para cualquier codename con el sentinel '*' (ADMINISTRADOR)", () => {
    expect(hasPermission(["*"], "cualquier.cosa")).toBe(true);
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

  it("true con el sentinel '*' aunque la lista de codenames requeridos no esté vacía", () => {
    expect(hasAnyPermission(["*"], ["cualquier.cosa"])).toBe(true);
  });
});

describe("sessionPermissionsFor", () => {
  it("colapsa el catálogo completo de ADMINISTRADOR al sentinel '*'", () => {
    // Caso real que rompía el login: Django devuelve get_all_permissions()
    // completo (~250 codenames) para un superusuario — eso no entra en una
    // cookie de sesión sin superar el límite práctico de ~4KB que aplican
    // los navegadores, y el Set-Cookie se descarta en silencio (ver
    // docs/AUDIT_LOG.md § 2026-09-02).
    const allDjangoPermissions = Array.from({ length: 246 }, (_, i) => `permiso.${i}`);
    expect(sessionPermissionsFor("ADMINISTRADOR", allDjangoPermissions)).toEqual(["*"]);
  });

  it("deja la lista intacta para cualquier otro rol", () => {
    expect(sessionPermissionsFor("JEFE_NACIONAL", ["roles.ver", "roles.editar"])).toEqual([
      "roles.ver",
      "roles.editar",
    ]);
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
