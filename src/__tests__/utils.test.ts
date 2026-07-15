import { describe, expect, it } from "vitest";
import { formatDate, isTaskOverdue } from "@/lib/utils";

describe("formatDate", () => {
  it("formatea una fecha-string ISO de solo fecha (parseada como medianoche UTC) como YYYY-MM-DD", () => {
    expect(formatDate("2026-07-05")).toBe("2026-07-05");
  });

  it("formatea un objeto Date usando getters UTC, no locales", () => {
    const d = new Date(Date.UTC(2026, 6, 5, 23, 0, 0)); // 2026-07-05 23:00 UTC
    expect(formatDate(d)).toBe("2026-07-05");
  });

  it("rellena con ceros mes y día de un solo dígito", () => {
    expect(formatDate("2026-01-09")).toBe("2026-01-09");
  });
});

describe("isTaskOverdue", () => {
  const endDate = "2026-07-05"; // domingo, medianoche UTC

  it("una tarea COMPLETADA nunca está vencida, sin importar la fecha", () => {
    const wayAfter = new Date("2027-01-01T12:00:00Z");
    expect(isTaskOverdue(endDate, "COMPLETADA", wayAfter)).toBe(false);
  });

  it("no está vencida mientras la referencia esté dentro del mismo día calendario de negocio que endDate", () => {
    const sameDay = new Date("2026-07-05T12:00:00Z"); // -5h -> sigue siendo 07-05
    expect(isTaskOverdue(endDate, "PENDIENTE", sameDay)).toBe(false);
  });

  it("no está vencida hasta el último instante del día calendario de negocio de endDate", () => {
    // 2026-07-06T04:59:59Z - 5h = 2026-07-05T23:59:59Z -> todavía día calendario 07-05
    const justBeforeBoundary = new Date("2026-07-06T04:59:59Z");
    expect(isTaskOverdue(endDate, "EN_PROGRESO", justBeforeBoundary)).toBe(false);
  });

  it("se marca vencida en cuanto el día calendario de negocio pasa a ser el siguiente", () => {
    // 2026-07-06T05:00:00Z - 5h = 2026-07-06T00:00:00Z -> ya es día calendario 07-06
    const atBoundary = new Date("2026-07-06T05:00:00Z");
    expect(isTaskOverdue(endDate, "PENDIENTE", atBoundary)).toBe(true);
  });

  it("está vencida varios días después de la fecha límite", () => {
    const wayAfter = new Date("2026-07-10T12:00:00Z");
    expect(isTaskOverdue(endDate, "EN_PROGRESO", wayAfter)).toBe(true);
  });
});
