import { describe, expect, it } from "vitest";
import { searchSettings, getDescriptor, descriptorsByCategory, SETTINGS_REGISTRY } from "@/components/settings/registry";

describe("searchSettings", () => {
  it("cadena vacía devuelve el registro completo", () => {
    expect(searchSettings("")).toEqual(SETTINGS_REGISTRY);
    expect(searchSettings("   ")).toEqual(SETTINGS_REGISTRY);
  });

  it("encuentra por coincidencia parcial en el label", () => {
    const results = searchSettings("ventana");
    expect(results.some((d) => d.id === "prediction-window")).toBe(true);
  });

  it("encuentra por coincidencia en keywords, no solo en label/description", () => {
    const results = searchSettings("snooze");
    expect(results.some((d) => d.id === "escritorio-digital-config")).toBe(true);
  });

  it("es insensible a mayúsculas y acentos", () => {
    const results = searchSettings("RETENCION");
    expect(results.some((d) => d.id === "retention-policy")).toBe(true);
  });

  it("sin coincidencias devuelve un array vacío", () => {
    expect(searchSettings("xyzxyz-no-deberia-existir")).toEqual([]);
  });
});

describe("getDescriptor", () => {
  it("devuelve el descriptor correcto por id", () => {
    expect(getDescriptor("holidays")?.label).toBe("Feriados");
  });

  it("devuelve undefined para un id inexistente", () => {
    expect(getDescriptor("no-existe")).toBeUndefined();
  });
});

describe("descriptorsByCategory", () => {
  it("filtra solo los descriptores de la categoría pedida", () => {
    const results = descriptorsByCategory("seguridad");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((d) => d.category === "seguridad")).toBe(true);
  });

  it("cada descriptor tiene un id único en todo el registro", () => {
    const ids = SETTINGS_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
