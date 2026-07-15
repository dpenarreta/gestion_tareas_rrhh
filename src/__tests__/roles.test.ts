import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  ROLE_LEVEL,
  canManageUsers,
  getVisibleRoles,
} from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

describe("ROLE_LEVEL", () => {
  it("define un nivel jerárquico correcto para cada uno de los 10 roles operativos", () => {
    expect(ROLE_LEVEL.JEFE_NACIONAL).toBe(4);
    expect(ROLE_LEVEL.COORDINADOR_NACIONAL).toBe(3);
    expect(ROLE_LEVEL.COORDINADOR_ZS).toBe(2);
    expect(ROLE_LEVEL.ANALISTA_CC).toBe(2);
    expect(ROLE_LEVEL.ANALISTA_SELECCION).toBe(2);
    expect(ROLE_LEVEL.ASISTENTE_SELECCION).toBe(1);
    expect(ROLE_LEVEL.ASISTENTE_GH).toBe(1);
    expect(ROLE_LEVEL.ASISTENTE_GH_ZS).toBe(1);
    expect(ROLE_LEVEL.TRABAJO_SOCIAL).toBe(1);
    expect(ROLE_LEVEL.ASISTENTE_NOMINA).toBe(1);
  });

  it("ADMINISTRADOR tiene el nivel más alto, por encima de JEFE_NACIONAL", () => {
    expect(ROLE_LEVEL.ADMINISTRADOR).toBeGreaterThan(ROLE_LEVEL.JEFE_NACIONAL);
  });
});

describe("getVisibleRoles", () => {
  it("JEFE_NACIONAL ve a todos los roles excepto a ADMINISTRADOR", () => {
    const visible = getVisibleRoles("JEFE_NACIONAL");
    expect(visible).not.toContain("ADMINISTRADOR");
    const nonAdminRoles = ALL_ROLES.filter((r) => r !== "ADMINISTRADOR");
    expect(visible.sort()).toEqual(nonAdminRoles.sort());
  });

  it("COORDINADOR_NACIONAL no puede ver datos de JEFE_NACIONAL", () => {
    const visible = getVisibleRoles("COORDINADOR_NACIONAL");
    expect(visible).not.toContain("JEFE_NACIONAL");
  });

  it("COORDINADOR_NACIONAL ve a todos los roles excepto Jefe Nacional y Administrador", () => {
    const visible = getVisibleRoles("COORDINADOR_NACIONAL");
    const expected = ALL_ROLES.filter(
      (r) => r !== "JEFE_NACIONAL" && r !== "ADMINISTRADOR"
    );
    expect(visible.sort()).toEqual(expected.sort());
  });

  it("COORDINADOR_ZS solo ve su propio rol y Asistente GH ZS", () => {
    expect(getVisibleRoles("COORDINADOR_ZS").sort()).toEqual(
      ["COORDINADOR_ZS", "ASISTENTE_GH_ZS"].sort()
    );
  });

  it("ANALISTA_CC ve su propio rol, Asistente GH y Trabajo Social", () => {
    expect(getVisibleRoles("ANALISTA_CC").sort()).toEqual(
      ["ANALISTA_CC", "ASISTENTE_GH", "TRABAJO_SOCIAL"].sort()
    );
  });

  it("ANALISTA_SELECCION ve su propio rol, Asistente Selección, Asistente GH y Trabajo Social", () => {
    expect(getVisibleRoles("ANALISTA_SELECCION").sort()).toEqual(
      ["ANALISTA_SELECCION", "ASISTENTE_SELECCION", "ASISTENTE_GH", "TRABAJO_SOCIAL"].sort()
    );
  });

  it.each<Role>([
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
  ])("%s solo ve sus propias tareas", (role) => {
    expect(getVisibleRoles(role)).toEqual([role]);
  });

  it("ningún rol operativo (no-Administrador) incluye ADMINISTRADOR en su lista de visibilidad", () => {
    for (const role of ALL_ROLES) {
      if (role === "ADMINISTRADOR") continue;
      expect(getVisibleRoles(role)).not.toContain("ADMINISTRADOR");
    }
  });

  it("ASISTENTE_NOMINA es invisible para todos los roles salvo JEFE_NACIONAL y COORDINADOR_NACIONAL (además de sí mismo)", () => {
    const otherRolesThatCanSeeNomina = ALL_ROLES.filter(
      (role) => role !== "ASISTENTE_NOMINA" && getVisibleRoles(role).includes("ASISTENTE_NOMINA")
    );
    expect(otherRolesThatCanSeeNomina.sort()).toEqual(
      ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"].sort()
    );
  });
});

describe("canManageUsers", () => {
  it("solo JEFE_NACIONAL, COORDINADOR_NACIONAL y ADMINISTRADOR pueden gestionar usuarios", () => {
    const managers = ALL_ROLES.filter((r) => canManageUsers(r));
    expect(managers.sort()).toEqual(
      ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"].sort()
    );
  });

  it("roles de nivel 1 y 2 no pueden gestionar usuarios", () => {
    expect(canManageUsers("ASISTENTE_GH")).toBe(false);
    expect(canManageUsers("COORDINADOR_ZS")).toBe(false);
    expect(canManageUsers("ANALISTA_CC")).toBe(false);
  });
});
