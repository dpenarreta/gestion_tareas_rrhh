import { describe, expect, it } from "vitest";
import { resolveEstadoGeneral } from "@/lib/executiveReporting/estadoGeneral";
import type { ExecutiveReportSnapshotData } from "@/lib/executiveReporting/snapshotData";

// `resolveEstadoGeneral` es una función pura que solo lee `members`,
// `teamSummary` y `estadoGeneral` — el fixture se limita a esos campos
// (casteado) en vez de construir un `ExecutiveReportSnapshotData` completo,
// igual que `nova.test.ts` hace con `ExecutiveReportContext`.
function fixture(overrides: {
  members?: unknown[];
  totalTasks?: number;
  totalConsultas?: number;
  avgCumplimiento?: number;
  avgCargaPct?: number;
  indiceEjecutivo?: ExecutiveReportSnapshotData["estadoGeneral"]["indiceEjecutivo"];
}): ExecutiveReportSnapshotData {
  return {
    members: overrides.members ?? [{ id: "u1" }],
    teamSummary: {
      avgCumplimiento: overrides.avgCumplimiento ?? 72,
      avgCargaPct: overrides.avgCargaPct ?? 95,
      totalCargaRealHours: 190,
      totalCargaBaseHours: 200,
      totalCompletedTasks: 29,
      totalConsultas: overrides.totalConsultas ?? 12,
      totalTasks: overrides.totalTasks ?? 40,
      hoursPerDay: 6.5,
      cargaRangeMin: 90,
      cargaRangeMax: 130,
    },
    estadoGeneral: {
      indiceEjecutivo: overrides.indiceEjecutivo ?? null,
      dataQuality: { pct: 88, issues: [] },
    },
  } as unknown as ExecutiveReportSnapshotData;
}

describe("resolveEstadoGeneral (constructor único de Estado General)", () => {
  it('devuelve "Sin datos para el período" únicamente cuando el snapshot está realmente vacío', () => {
    const result = resolveEstadoGeneral(fixture({ members: [], totalTasks: 0, totalConsultas: 0 }));
    expect(result.nivel).toBe("Sin datos para el período");
    expect(result.color).toBe("gray");
    expect(result.valor).toBeNull();
  });

  it("usa el Índice Ejecutivo tal cual cuando el snapshot lo trae (mes calendario en curso)", () => {
    const indice = { valor: 78, nivel: "Bueno" as const, color: "green" as const, explicacion: "El equipo opera de forma saludable.", avgPerformance: 80, avgEquilibrio: 76, variacion: 2 };
    const result = resolveEstadoGeneral(fixture({ indiceEjecutivo: indice }));
    expect(result).toMatchObject({ nivel: "Bueno", color: "green", valor: 78, explicacion: indice.explicacion, fromIndiceEjecutivo: true });
  });

  it(
    "bug real corregido: un snapshot CON datos (colaboradores/tareas/consultas) pero SIN Índice Ejecutivo " +
      "(rango de meses, rango personalizado, o un mes ya cerrado) calcula un Estado General normal, nunca 'Sin datos'",
    () => {
      const result = resolveEstadoGeneral(fixture({ indiceEjecutivo: null, avgCumplimiento: 90, avgCargaPct: 100 }));
      expect(result.nivel).not.toBe("Sin datos para el período");
      expect(result.valor).not.toBeNull();
      expect(result.fromIndiceEjecutivo).toBe(false);
      // Carga en el 100% ideal → cargaScore 100; Cumplimiento 90 → valor = (90+100)/2 = 95 → "Excelente".
      expect(result.nivel).toBe("Excelente");
      expect(result.valor).toBe(95);
    },
  );

  it("la aproximación de respaldo penaliza tanto sobrecarga como subutilización de Carga Laboral", () => {
    const sobrecargado = resolveEstadoGeneral(fixture({ avgCumplimiento: 80, avgCargaPct: 150 }));
    const subutilizado = resolveEstadoGeneral(fixture({ avgCumplimiento: 80, avgCargaPct: 50 }));
    // 150% y 50% están ambos a 50 puntos del 100% ideal → mismo cargaScore (50) → mismo resultado.
    expect(sobrecargado.valor).toBe(subutilizado.valor);
  });

  it("nunca lanza cuando teamSummary/estadoGeneral vienen ausentes — degrada a 'Sin datos'", () => {
    const broken = { members: [{ id: "u1" }] } as unknown as ExecutiveReportSnapshotData;
    expect(() => resolveEstadoGeneral(broken)).not.toThrow();
    expect(resolveEstadoGeneral(broken).nivel).toBe("Sin datos para el período");
  });
});
