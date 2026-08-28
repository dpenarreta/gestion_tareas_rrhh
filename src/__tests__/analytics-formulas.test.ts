import { describe, expect, it } from "vitest";
import { computeSimpleScore, computeEstimatedVsRealRatio, classifyEstadoOperativo } from "@/lib/analytics";
import { computePriorityCompliance, isCompletedOnTime } from "@/lib/priorityCompliance";

// Fórmulas críticas del motor Analytics (§Sprint 4 S4-I) — cada una con caso
// normal, límite, sin datos y extremo, verificando ausencia de NaN/Infinity.
//
// Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): se retiró la cobertura de
// cargaHealthScore/capacityToScore/classifyOperationalRisk/
// computePredictionConfidencePct — esas funciones se eliminaron de
// `src/lib/analytics.ts` (el cálculo ya lo hace Django); esa cobertura ya
// existe del lado Django (`apps/analytics/tests/`). Fase 85 (2026-08-27)
// retira además consistencyLevelFromCv/consistencyPctFromCv — su único
// caller real, computeConsistency, se eliminó al cortar el bloque
// "Predictivo" de Reportes Ejecutivos a Django.

function expectFinite(...values: number[]) {
  for (const v of values) expect(Number.isFinite(v)).toBe(true);
}

describe("classifyEstadoOperativo (Estado Operativo — Sprint Analytics 2.0, Bloques 11-12)", () => {
  it("caso normal: score en zona media cae en 'Requiere Atención'", () => {
    const r = classifyEstadoOperativo(65);
    expect(r.estado).toBe("Requiere Atención");
    expect(r.color).toBe("yellow");
  });

  it("caso límite: exactamente en cada corte (90/75/60/40) clasifica hacia el nivel superior, inclusive", () => {
    expect(classifyEstadoOperativo(90).estado).toBe("Equilibrio Óptimo");
    expect(classifyEstadoOperativo(75).estado).toBe("Equilibrio Estable");
    expect(classifyEstadoOperativo(60).estado).toBe("Requiere Atención");
    expect(classifyEstadoOperativo(40).estado).toBe("Riesgo Operativo");
  });

  it("caso límite: un punto por debajo de cada corte cae en el nivel inferior", () => {
    expect(classifyEstadoOperativo(89).estado).toBe("Equilibrio Estable");
    expect(classifyEstadoOperativo(74).estado).toBe("Requiere Atención");
    expect(classifyEstadoOperativo(59).estado).toBe("Riesgo Operativo");
    expect(classifyEstadoOperativo(39).estado).toBe("Desequilibrio Crítico");
  });

  it("caso sin datos: score 0 → Desequilibrio Crítico, sin lanzar", () => {
    const r = classifyEstadoOperativo(0);
    expect(r.estado).toBe("Desequilibrio Crítico");
    expect(r.color).toBe("red");
  });

  it("caso extremo: score fuera de rango (>100 o negativo) sigue clasificando sin NaN ni excepción", () => {
    expect(classifyEstadoOperativo(150).estado).toBe("Equilibrio Óptimo");
    expect(classifyEstadoOperativo(-10).estado).toBe("Desequilibrio Crítico");
  });

  it("cada tier trae emoji, rango y explicación ejecutiva no vacíos", () => {
    for (const score of [95, 80, 65, 45, 10]) {
      const r = classifyEstadoOperativo(score);
      expect(r.emoji.length).toBeGreaterThan(0);
      expect(r.rango.length).toBeGreaterThan(0);
      expect(r.explicacionEjecutiva.length).toBeGreaterThan(0);
    }
  });
});

describe("computeSimpleScore (Score simple 0-100)", () => {
  it("caso normal: mezcla típica de cumplimiento/carga/progreso/comentarios", () => {
    const score = computeSimpleScore(80, 100, 50, 5);
    expectFinite(score);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("caso límite: todo en cero → 20 (el componente de carga no penaliza cargaRatio=0, solo el exceso sobre 100)", () => {
    // scoreC=0 (0% cumplimiento) + scoreL=20 (sin exceso de carga) + scoreA=0 + scoreAct=0.
    expect(computeSimpleScore(0, 0, 0, 0)).toBe(20);
  });

  it("caso sin datos: sin conteo de comentarios (parámetro omitido) usa 0 por defecto", () => {
    expect(computeSimpleScore(50, 100, 50)).toBe(computeSimpleScore(50, 100, 50, 0));
  });

  it("caso extremo: cumplimiento/progreso/comentarios al máximo con sobrecarga extrema → acotado, sin NaN/Infinity", () => {
    const score = computeSimpleScore(100, 100000, 100, 100000);
    expectFinite(score);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("caso extremo: valores negativos no producen NaN (defensivo)", () => {
    const score = computeSimpleScore(-50, -100, -50, -10);
    expectFinite(score);
  });
});

describe("computeEstimatedVsRealRatio (base de Carga laboral por tareas)", () => {
  it("caso normal: horas reales proporcionales a las estimadas", () => {
    expect(computeEstimatedVsRealRatio(50, 100)).toBe(50);
  });

  it("caso límite: sin horas estimadas pero con horas reales → 200 (centinela, no división por cero)", () => {
    expect(computeEstimatedVsRealRatio(10, 0)).toBe(200);
  });

  it("caso sin datos: ni reales ni estimadas → 0", () => {
    expect(computeEstimatedVsRealRatio(0, 0)).toBe(0);
  });

  it("caso extremo: horas reales muy superiores a las estimadas → proporcional, sin Infinity", () => {
    const ratio = computeEstimatedVsRealRatio(100000, 1);
    expectFinite(ratio);
    expect(ratio).toBe(10000000);
  });
});

describe("computePriorityCompliance + isCompletedOnTime (Cumplimiento)", () => {
  const endDate = new Date("2026-06-10");

  it("caso normal: mezcla de tareas a tiempo, tardías y pendientes por prioridad", () => {
    const tasks = [
      { priority: "ALTA", status: "COMPLETADA", completedAt: new Date("2026-06-09"), endDate },
      { priority: "ALTA", status: "PENDIENTE", completedAt: null, endDate },
      { priority: "MEDIA", status: "COMPLETADA", completedAt: new Date("2026-06-12"), endDate }, // tardía
    ];
    const result = computePriorityCompliance(tasks);
    const alta = result.find((r) => r.priority === "ALTA")!;
    const media = result.find((r) => r.priority === "MEDIA")!;
    expect(alta).toMatchObject({ total: 2, completedOnTime: 1, pct: 50 });
    expect(media).toMatchObject({ total: 1, completedOnTime: 0, pct: 0 }); // tardía no cuenta
  });

  it("caso límite: sin tareas → total 0, pct 0 (no NaN) para las 3 prioridades", () => {
    const result = computePriorityCompliance([]);
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r).toMatchObject({ total: 0, completedOnTime: 0, pct: 0 });
      expectFinite(r.pct);
    }
  });

  it("caso sin datos: completedAt undefined (no solo null) no debe lanzar ni contar como a tiempo", () => {
    const tasks = [{ priority: "BAJA", status: "COMPLETADA", completedAt: undefined as unknown as null, endDate }];
    expect(() => computePriorityCompliance(tasks)).not.toThrow();
    const baja = computePriorityCompliance(tasks).find((r) => r.priority === "BAJA")!;
    expect(baja.completedOnTime).toBe(0);
  });

  it("caso extremo: completedAt exactamente igual a endDate cuenta como a tiempo (inclusive)", () => {
    expect(isCompletedOnTime({ status: "COMPLETADA", completedAt: endDate, endDate })).toBe(true);
  });

  it("caso extremo: tarea no completada nunca cuenta como a tiempo aunque completedAt esté seteado", () => {
    expect(isCompletedOnTime({ status: "PENDIENTE", completedAt: new Date("2026-06-01"), endDate })).toBe(false);
  });

  // Corrección 2026-07-24 (ver docs/AUDIT_LOG.md): comparación por día
  // calendario en huso de negocio (UTC-5), no por instante UTC crudo.
  it("bug corregido: completada el mismo día calendario (huso de negocio) cuenta como a tiempo aunque completedAt.getTime() > endDate.getTime()", () => {
    // endDate = 2026-06-10T00:00Z (medianoche UTC del día de vencimiento).
    // completedAt = 2026-06-10T15:30Z — mismo día calendario en UTC-5
    // (10:30am hora de negocio), pero un timestamp UTC crudo posterior a
    // medianoche → antes de la corrección esto daba `false`.
    const completedAt = new Date("2026-06-10T15:30:00.000Z");
    expect(isCompletedOnTime({ status: "COMPLETADA", completedAt, endDate })).toBe(true);
  });

  it("bug corregido: completada pasada la medianoche UTC pero aún dentro del día de negocio cuenta como a tiempo", () => {
    // completedAt cae en la madrugada UTC del día SIGUIENTE, pero al
    // restarle el huso de negocio (UTC-5) sigue siendo el mismo día
    // calendario que endDate.
    const completedAt = new Date("2026-06-11T03:58:00.000Z");
    expect(isCompletedOnTime({ status: "COMPLETADA", completedAt, endDate })).toBe(true);
  });

  it("sigue clasificando correctamente como tardía una tarea completada un día calendario después (huso de negocio)", () => {
    const completedAt = new Date("2026-06-11T17:26:00.000Z"); // claramente el día siguiente en UTC-5
    expect(isCompletedOnTime({ status: "COMPLETADA", completedAt, endDate })).toBe(false);
  });
});

