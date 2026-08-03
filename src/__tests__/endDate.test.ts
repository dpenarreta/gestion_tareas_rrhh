import { describe, expect, it } from "vitest";
import { canValidateEndDate, isValidEndDateAction, END_DATE_STATUS_LABEL, END_DATE_STATUS_EMOJI } from "@/lib/endDate";

describe("canValidateEndDate", () => {
  it("permite a Administrador/Jefe Nacional/Coordinador Nacional validar la fecha fin de otros", () => {
    expect(canValidateEndDate("ADMINISTRADOR", "otro", "yo")).toBe(true);
    expect(canValidateEndDate("JEFE_NACIONAL", "otro", "yo")).toBe(true);
    expect(canValidateEndDate("COORDINADOR_NACIONAL", "otro", "yo")).toBe(true);
  });

  it("nunca permite validar la propia fecha fin, sin importar el rol", () => {
    expect(canValidateEndDate("ADMINISTRADOR", "yo", "yo")).toBe(false);
    expect(canValidateEndDate("JEFE_NACIONAL", "yo", "yo")).toBe(false);
  });

  it("roles fuera de la whitelist no pueden validar, aunque no sean el responsable", () => {
    expect(canValidateEndDate("COORDINADOR_ZS", "otro", "yo")).toBe(false);
    expect(canValidateEndDate("ASISTENTE_GH", "otro", "yo")).toBe(false);
  });
});

describe("isValidEndDateAction", () => {
  it("acepta APROBAR/MODIFICAR/RECHAZAR", () => {
    expect(isValidEndDateAction("APROBAR")).toBe(true);
    expect(isValidEndDateAction("MODIFICAR")).toBe(true);
    expect(isValidEndDateAction("RECHAZAR")).toBe(true);
  });

  it("rechaza valores inválidos", () => {
    expect(isValidEndDateAction("APROBADA")).toBe(false);
    expect(isValidEndDateAction("")).toBe(false);
    expect(isValidEndDateAction(undefined)).toBe(false);
    expect(isValidEndDateAction(123)).toBe(false);
  });
});

describe("END_DATE_STATUS_LABEL / END_DATE_STATUS_EMOJI", () => {
  it("cubre los 4 estados con el emoji correcto (spec: 🟡🟢🔵🔴)", () => {
    expect(END_DATE_STATUS_EMOJI.PENDIENTE).toBe("🟡");
    expect(END_DATE_STATUS_EMOJI.APROBADA).toBe("🟢");
    expect(END_DATE_STATUS_EMOJI.MODIFICADA).toBe("🔵");
    expect(END_DATE_STATUS_EMOJI.RECHAZADA).toBe("🔴");
    expect(Object.keys(END_DATE_STATUS_LABEL)).toHaveLength(4);
  });
});
