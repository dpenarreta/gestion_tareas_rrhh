import { describe, expect, it } from "vitest";
import { generateReportId, generateLegacyReportId, isValidReportIdFormat } from "@/lib/executiveReporting/reportId";

describe("generateReportId", () => {
  it("tiene el formato NXR-YYYYMMDD-HHMMSS-XXXX", () => {
    const id = generateReportId(new Date("2026-07-28T18:35:22.000Z"));
    expect(id).toMatch(/^NXR-\d{8}-\d{6}-[A-Z0-9]{4}$/);
  });

  it("usa huso de negocio (UTC-5), no UTC crudo", () => {
    // 18:35:22 UTC - 5h = 13:35:22, mismo día calendario
    expect(generateReportId(new Date("2026-07-28T18:35:22.000Z"))).toMatch(/^NXR-20260728-133522-/);
  });

  it("desplaza el día calendario cuando el instante UTC cae de madrugada", () => {
    // 02:00:00 UTC del 28 - 5h = 21:00:00 del día 27 (huso de negocio)
    expect(generateReportId(new Date("2026-07-28T02:00:00.000Z"))).toMatch(/^NXR-20260727-210000-/);
  });

  it("el sufijo evita caracteres ambiguos (0/O/1/I)", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateReportId();
      const suffix = id.split("-")[3];
      expect(suffix).not.toMatch(/[01OI]/);
    }
  });

  it("varía el sufijo entre llamadas al mismo instante (la unicidad dura la da el @unique de BD + reintento, no el generador)", () => {
    const now = new Date("2026-07-28T18:35:22.000Z");
    const ids = new Set(Array.from({ length: 20 }, () => generateReportId(now)));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("generateLegacyReportId", () => {
  it("tiene el formato NXR-LEGACY-YYYYMMDD-XXXX (sin componente de hora)", () => {
    const id = generateLegacyReportId(new Date("2026-06-30T10:00:00.000Z"));
    expect(id).toMatch(/^NXR-LEGACY-\d{8}-[A-Z0-9]{4}$/);
  });
});

describe("isValidReportIdFormat", () => {
  it("acepta ids nativos y legacy válidos", () => {
    expect(isValidReportIdFormat("NXR-20260728-143522-7F3C")).toBe(true);
    expect(isValidReportIdFormat(generateLegacyReportId(new Date()))).toBe(true);
  });

  it("rechaza formatos inválidos", () => {
    expect(isValidReportIdFormat("NXR-2026072-143522-7F3C")).toBe(false); // fecha corta
    expect(isValidReportIdFormat("NXR-20260728-1435-7F3C")).toBe(false); // hora corta
    expect(isValidReportIdFormat("NXR-20260728-143522-7F30")).toBe(false); // '0' ambiguo en sufijo
    expect(isValidReportIdFormat("MXR-20260728-143522-7F3C")).toBe(false); // prefijo distinto
    expect(isValidReportIdFormat("")).toBe(false);
  });
});
