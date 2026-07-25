import { describe, expect, it } from "vitest";
import {
  cargaHealthScore,
  capacityToScore,
  computeSimpleScore,
  computeEstimatedVsRealRatio,
  consistencyLevelFromCv,
  consistencyPctFromCv,
  computePredictionConfidencePct,
  classifyOperationalRisk,
  classifyEstadoOperativo,
  type ConsistencyResult,
  type HealthScoreResult,
} from "@/lib/analytics";
import { computePriorityCompliance, isCompletedOnTime } from "@/lib/priorityCompliance";
import { computeEquilibrioInsights, explainEquilibrioFactor, explainEquilibrioMeaning, explainEquilibrioImpact, type Confidence } from "@/lib/insightsEngine";

// Fórmulas críticas del motor Analytics (§Sprint 4 S4-I) — cada una con caso
// normal, límite, sin datos y extremo, verificando ausencia de NaN/Infinity.

function expectFinite(...values: number[]) {
  for (const v of values) expect(Number.isFinite(v)).toBe(true);
}

describe("cargaHealthScore (Carga laboral)", () => {
  const HIGH = 7.5;
  const OVERLOAD = 8.5;

  it("caso normal: horas dentro del rango óptimo → 100", () => {
    expect(cargaHealthScore(7, 6.5, HIGH, OVERLOAD)).toBe(100);
  });

  it("caso límite: exactamente en la base y en el límite alto → 100", () => {
    expect(cargaHealthScore(6.5, 6.5, HIGH, OVERLOAD)).toBe(100);
    expect(cargaHealthScore(HIGH, 6.5, HIGH, OVERLOAD)).toBe(100);
  });

  it("caso sin datos: base <= 0 → 100 (nada que evaluar, no NaN)", () => {
    const score = cargaHealthScore(5, 0, HIGH, OVERLOAD);
    expect(score).toBe(100);
    expectFinite(score);
  });

  it("caso extremo: muy por debajo de la base → tiende a 0, nunca negativo", () => {
    const score = cargaHealthScore(0, 6.5, HIGH, OVERLOAD);
    expect(score).toBe(0);
    expectFinite(score);
  });

  it("caso extremo: muy por encima del límite de sobrecarga → 0, no Infinity/NaN", () => {
    const score = cargaHealthScore(1000, 6.5, HIGH, OVERLOAD);
    expect(score).toBe(0);
    expectFinite(score);
  });

  it("caso extremo: límite alto == límite de sobrecarga (span mínimo) → no división por cero", () => {
    const score = cargaHealthScore(9, 6.5, HIGH, HIGH);
    expectFinite(score);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("capacityToScore (Capacidad disponible)", () => {
  it("caso normal: capacidad alta → 100", () => {
    expect(capacityToScore("alta", 30)).toBe(100);
  });

  it("caso límite: capacidad limitada / sin planificación → 70", () => {
    expect(capacityToScore("limitada", 12)).toBe(70);
    expect(capacityToScore("sin-planificacion", 0)).toBe(70);
  });

  it("caso sin datos: disponiblePct exactamente 0 sin sobrecarga → 40", () => {
    expect(capacityToScore("no-asignar", 0)).toBe(40);
  });

  it("caso extremo: sobrecarga severa (disponiblePct muy negativo) → 0", () => {
    const score = capacityToScore("sobrecarga", -500);
    expect(score).toBe(0);
    expectFinite(score);
  });

  // Sprint Analytics 2.0 (Bloque 9) — normalización progresiva del rango de
  // sobrecarga. Verifica los 7 anclajes exactos del spec (score = 100 + 2×pct,
  // acotado a [0,100]) — antes de este sprint, todo estado "sobrecarga" caía
  // directo a 0. Nótese que pct=0 con estado "sobrecarga" (borde real: una
  // sobrecarga leve puede redondear a 0% exacto) entra a la curva, a
  // diferencia de pct=0 con "no-asignar" (ver caso arriba).
  it("Bloque 9 — reproduce los 7 anclajes exactos del spec para disponiblePct negativo", () => {
    expect(capacityToScore("sobrecarga", 0)).toBe(100);
    expect(capacityToScore("sobrecarga", -5)).toBe(90);
    expect(capacityToScore("sobrecarga", -10)).toBe(80);
    expect(capacityToScore("sobrecarga", -20)).toBe(60);
    expect(capacityToScore("sobrecarga", -30)).toBe(40);
    expect(capacityToScore("sobrecarga", -40)).toBe(20);
    expect(capacityToScore("sobrecarga", -50)).toBe(0);
  });

  it("Bloque 9 — más allá de -50% se mantiene acotado en 0, nunca negativo", () => {
    expect(capacityToScore("sobrecarga", -60)).toBe(0);
    expect(capacityToScore("sobrecarga", -100)).toBe(0);
  });

  it("Bloque 9 — el lado positivo (alta/limitada/sin-planificacion) no cambió", () => {
    expect(capacityToScore("alta", 50)).toBe(100);
    expect(capacityToScore("limitada", 5)).toBe(70);
    expect(capacityToScore("sin-planificacion", 0)).toBe(70);
  });
});

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

describe("computeEquilibrioInsights / explainEquilibrioFactor (Sprint Analytics 2.0, Bloques 4-6-8)", () => {
  const CONFIDENCE: Confidence = { stars: 3, label: "Confiabilidad media" };

  function healthScore(factors: HealthScoreResult["factors"]): HealthScoreResult {
    return {
      score: 70,
      classification: "Bueno",
      classificationColor: "yellow",
      factors,
      engineVersion: "1.5.0",
      explain: { formula: "", steps: [] },
    };
  }

  it("caso normal: factor Alto genera fortaleza (tone positive), factor Bajo genera oportunidad (tone risk)", () => {
    const insights = computeEquilibrioInsights(
      healthScore([
        { name: "Cumplimiento", rawLabel: "95%", weight: 30, points: 29, detail: "" }, // 96.7 normalizado → Alto
        { name: "Carga laboral", rawLabel: "9.5h/día", weight: 20, points: 4, detail: "" }, // 20 normalizado → Bajo
      ]),
      CONFIDENCE
    );
    const fortaleza = insights.find((i) => i.id.includes("Cumplimiento"));
    const oportunidad = insights.find((i) => i.id.includes("Carga laboral"));
    expect(fortaleza?.tone).toBe("positive");
    expect(fortaleza?.accion?.impact).toBeNull();
    expect(oportunidad?.tone).toBe("risk");
    expect(oportunidad?.accion).not.toBeNull();
  });

  it("caso límite: factor en zona 'Medio' (40-70 normalizado) no genera insight (evita ruido)", () => {
    const insights = computeEquilibrioInsights(
      healthScore([{ name: "Consistencia", rawLabel: "Variable (55%)", weight: 20, points: 11, detail: "" }]), // 55 normalizado → Medio
      CONFIDENCE
    );
    expect(insights).toHaveLength(0);
  });

  it("caso sin datos: sin factores → sin insights, no lanza", () => {
    expect(() => computeEquilibrioInsights(healthScore([]), CONFIDENCE)).not.toThrow();
    expect(computeEquilibrioInsights(healthScore([]), CONFIDENCE)).toHaveLength(0);
  });

  it("caso extremo: dimensión sin mapa de explicación conocido (nombre inesperado) no lanza y usa fallback genérico", () => {
    const insights = computeEquilibrioInsights(healthScore([{ name: "Dimensión Desconocida", rawLabel: "0", weight: 10, points: 0, detail: "" }]), CONFIDENCE);
    expect(insights[0].explicacion.length).toBeGreaterThan(0);
  });

  it("explainEquilibrioFactor: cubre TODAS las 5 dimensiones incluida la zona Medio (a diferencia de computeEquilibrioInsights)", () => {
    for (const name of ["Cumplimiento", "Tareas vencidas", "Consistencia", "Carga laboral", "Capacidad futura"]) {
      expect(explainEquilibrioFactor(name, 55).length).toBeGreaterThan(0); // 55 = Medio, igual devuelve texto
      expect(explainEquilibrioFactor(name, 95).length).toBeGreaterThan(0);
      expect(explainEquilibrioFactor(name, 10).length).toBeGreaterThan(0);
    }
  });
});

describe("explainEquilibrioMeaning / explainEquilibrioImpact (Sprint Analytics 2.0, Bloques 3 y 7)", () => {
  it("caso normal: cada uno de los 5 estados produce un párrafo de significado y una frase de impacto no vacíos", () => {
    for (const score of [95, 80, 65, 45, 10]) {
      const estado = classifyEstadoOperativo(score);
      expect(explainEquilibrioMeaning(estado, null).length).toBeGreaterThan(0);
      expect(explainEquilibrioImpact(estado).length).toBeGreaterThan(0);
    }
  });

  it("caso límite: con tendencia disponible, el párrafo de significado incorpora la frase de tendencia", () => {
    const estado = classifyEstadoOperativo(80);
    const withTrend = explainEquilibrioMeaning(estado, { available: true, direction: "mejora", scoreDelta: 5, bullets: [] });
    const withoutTrend = explainEquilibrioMeaning(estado, null);
    expect(withTrend.length).toBeGreaterThan(withoutTrend.length);
    expect(withTrend.startsWith(withoutTrend)).toBe(true);
  });

  it("caso sin datos: tendencia no disponible no agrega texto de tendencia", () => {
    const estado = classifyEstadoOperativo(80);
    const meaning = explainEquilibrioMeaning(estado, { available: false, direction: "estable", scoreDelta: 0, bullets: [], reason: "Sin historial" });
    expect(meaning).toBe(explainEquilibrioMeaning(estado, null));
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

describe("consistencyLevelFromCv / consistencyPctFromCv (Consistencia — Sprint 1 S1-B)", () => {
  it("caso normal: variación moderada → 'consistente', pct entre 0 y 100", () => {
    const { level } = consistencyLevelFromCv(15);
    expect(level).toBe("consistente");
    const pct = consistencyPctFromCv(15);
    expectFinite(pct);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it("caso límite: CV = 0 (sin variación) → 'muy-consistente' y pct = 100", () => {
    expect(consistencyLevelFromCv(0).level).toBe("muy-consistente");
    expect(consistencyPctFromCv(0)).toBe(100);
  });

  it("caso sin datos: no aplica (función pura) — se documenta en computeConsistency vía available:false", () => {
    expect(true).toBe(true);
  });

  it("caso extremo: CV muy alto → 'muy-variable' y pct tiende a 0 sin ser negativo ni NaN", () => {
    expect(consistencyLevelFromCv(100000).level).toBe("muy-variable");
    const pct = consistencyPctFromCv(100000);
    expectFinite(pct);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThan(1);
  });

  it("nunca excede 100% (el bug original que motivó S1-B)", () => {
    for (const cv of [0, 1, 5, 10, 50, 1000]) {
      expect(consistencyPctFromCv(cv)).toBeLessThanOrEqual(100);
    }
  });
});

describe("classifyOperationalRisk (Riesgo Operativo)", () => {
  const MEDIO = 31;
  const ALTO = 61;
  const CRITICO = 81;

  it("caso normal: score en zona media", () => {
    const r = classifyOperationalRisk(45, MEDIO, ALTO, CRITICO);
    expect(r.classification).toBe("Medio");
    expect(r.classificationColor).toBe("yellow");
  });

  it("caso límite: exactamente en cada umbral (inclusive hacia arriba)", () => {
    expect(classifyOperationalRisk(MEDIO, MEDIO, ALTO, CRITICO).classification).toBe("Medio");
    expect(classifyOperationalRisk(ALTO, MEDIO, ALTO, CRITICO).classification).toBe("Alto");
    expect(classifyOperationalRisk(CRITICO, MEDIO, ALTO, CRITICO).classification).toBe("Crítico");
  });

  it("caso sin datos: score 0 → Bajo", () => {
    const r = classifyOperationalRisk(0, MEDIO, ALTO, CRITICO);
    expect(r.classification).toBe("Bajo");
    expect(r.classificationColor).toBe("green");
  });

  it("caso extremo: score muy por encima de 100 (suma de factores fuera de rango) → sigue clasificando sin lanzar", () => {
    const r = classifyOperationalRisk(99999, MEDIO, ALTO, CRITICO);
    expect(r.classification).toBe("Crítico");
    expect(r.classificationColor).toBe("red");
  });
});

describe("computePredictionConfidencePct (Predicción — Sprint 1 S1-C)", () => {
  const AVAILABLE_CONSISTENT: ConsistencyResult = {
    available: true,
    level: "consistente",
    label: "Consistente",
    coefficientOfVariation: 15,
    consistencyPct: 87,
    weeksAnalyzed: 6,
    daysAnalyzed: 30,
    interpretation: "Variabilidad baja entre semanas.",
    reliability: { level: "media", stars: 3, label: "Confiabilidad media" },
    explain: { formula: "CV = promedio(CV horas, CV tareas completadas, CV cumplimiento)", periodsUsed: [], periodsExcluded: [], steps: [], impactNote: null },
  };
  const NOT_AVAILABLE: ConsistencyResult = { available: false, reason: "Sin historial suficiente" };

  it("caso normal: datos suficientes y consistencia media → confianza intermedia, nunca 100%", () => {
    const pct = computePredictionConfidencePct(3, AVAILABLE_CONSISTENT, 15);
    expectFinite(pct);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(92);
  });

  it("caso límite: máximo de datos/consistencia/cero días restantes → tope exacto de 92%, nunca 100%", () => {
    const perfect: ConsistencyResult = { ...AVAILABLE_CONSISTENT, level: "muy-consistente" };
    const pct = computePredictionConfidencePct(6, perfect, 0);
    expect(pct).toBe(92);
  });

  it("caso sin datos: 0 semanas y consistencia no disponible → confianza mínima, no NaN", () => {
    const pct = computePredictionConfidencePct(0, NOT_AVAILABLE, 30);
    expectFinite(pct);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThan(92);
  });

  it("caso extremo: muchísimas semanas y días restantes fuera de rango → se acota, nunca supera 92% ni es negativo", () => {
    const pct = computePredictionConfidencePct(1000, AVAILABLE_CONSISTENT, 10000);
    expectFinite(pct);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(92);
  });

  it("nunca alcanza el 100% (el bug original que motivó S1-C)", () => {
    for (const weeks of [0, 1, 6, 100]) {
      for (const days of [0, 15, 30, 1000]) {
        expect(computePredictionConfidencePct(weeks, AVAILABLE_CONSISTENT, days)).toBeLessThanOrEqual(92);
      }
    }
  });
});
