/**
 * Capa de explicabilidad (Sprint 6.5) — funciones puras de PRESENTACIÓN sobre
 * valores YA calculados por el Motor Analytics (src/lib/analytics.ts). Nunca
 * recalcula un KPI, nunca accede a la base de datos, nunca cambia una
 * fórmula ni un peso. Solo traduce números ya obtenidos a lenguaje ejecutivo
 * (rango, nivel, confianza) — ver Sprint 6.5 § objetivo.
 *
 * Sin "server-only": es pura, así que se puede importar tanto desde
 * componentes cliente (SmartBenchmark.tsx, AdvancedAnalytics.tsx) como desde
 * rutas de API.
 */

import type { KpiColor } from "@/components/kpis/types";

export type ScoreLevel = "Bajo" | "Medio" | "Alto" | "Muy alto";

// ── Umbral compartido 80/60 (§Analytics Calculation Registry D10) ───────────
// `cumplimientoColor` y `resultBarClass` reimplementaban por separado el mismo
// criterio "bueno ≥80% / regular ≥60% / malo <60%" en 4 sitios (3 rutas de
// /api/kpis + InsightCards.tsx) — única fuente ahora.

type ScoreBand = "good" | "warning" | "bad";

function scoreBand8060(pct: number): ScoreBand {
  if (pct >= 80) return "good";
  if (pct >= 60) return "warning";
  return "bad";
}

/** `KpiColor` para un % (cumplimiento, etc.) — única fuente para /api/kpis/[userId], /api/kpis/me y /api/kpis/executive. */
export function cumplimientoColor(pct: number): KpiColor {
  const band = scoreBand8060(pct);
  return band === "good" ? "green" : band === "warning" ? "yellow" : "red";
}

/** Clase Tailwind de fondo para una barra de resultado 0-100, mismo umbral que `cumplimientoColor` — única fuente para InsightCards.tsx. */
export function resultBarClass(pct: number): string {
  const band = scoreBand8060(pct);
  return band === "good" ? "bg-success" : band === "warning" ? "bg-warning" : "bg-danger";
}

/**
 * Invierte `points/weight` → valor normalizado 0-100 (1 decimal), para
 * modales "¿Cómo se obtuvo?" que muestran `normalizedValue` a partir de
 * factores ya calculados (`HealthFactor`/`RiskFactor`, que solo traen
 * `points`/`weight`, no el valor normalizado en sí) — antes duplicada en
 * AdvancedAnalytics.tsx y OperationalRiskCard.tsx (§D10).
 */
export function derivedNormalizedValue(points: number, weight: number): number {
  return weight > 0 ? Math.round((points / weight) * 100 * 10) / 10 : 0;
}

// ── Nivel de madurez del dato (§S2-H) — estrellas 1-5 según cuánto historial
// respalda un KPI (más historial/registro = más estrellas), puramente
// informativo, no altera el cálculo. Antes vivían en AdvancedAnalytics.tsx —
// se movieron aquí (mismo criterio que el resto del archivo: helpers de
// presentación compartidos, ver §D10) para que KpisModule/MyKpisModule no
// dependan de un componente cliente solo para una función pura.

/** Cumplimiento/carga: más tareas o días con registro en el período → más estrellas. */
export function maturityFromCount(count: number, thresholds: [number, number, number, number] = [1, 3, 6, 10]): 1 | 2 | 3 | 4 | 5 {
  const [t1, t2, t3, t4] = thresholds;
  if (count >= t4) return 5;
  if (count >= t3) return 4;
  if (count >= t2) return 3;
  if (count >= t1) return 2;
  return 1;
}

/** Predicción: más semanas de historial disponibles → más estrellas. */
export function maturityFromWeeks(weeksOfData: number): 1 | 2 | 3 | 4 | 5 {
  if (weeksOfData >= 6) return 5;
  if (weeksOfData >= 4) return 4;
  if (weeksOfData >= 2) return 3;
  if (weeksOfData >= 1) return 2;
  return 1;
}

/** Mismos umbrales que ScoreZoneBar (0-40-70-90-100, ver AdvancedAnalytics.tsx) — un puntaje normalizado siempre cae en una de estas 4 franjas. */
export function scoreLevel(normalizedValue: number): ScoreLevel {
  if (normalizedValue < 40) return "Bajo";
  if (normalizedValue < 70) return "Medio";
  if (normalizedValue < 90) return "Alto";
  return "Muy alto";
}

/** Frase ejecutiva para explicar por qué un valor normalizado cayó en su rango — ver Sprint 6.5 § S6.5-I. */
export function scoreLevelExplanation(normalizedValue: number): string {
  const level = scoreLevel(normalizedValue);
  return `Pertenece al rango ${level}. Según la configuración actual, este rango equivale a ${normalizedValue} puntos de 100.`;
}

export type ConfidenceIndicators = { dataQualityPct: number; reliabilityPct: number };

/** Confiabilidad estadística a partir de las mismas 4 estrellas ya usadas por Consistencia (§Analytics Engine v1.3.1) — solo las traduce a %, no cambia su cálculo. */
export function reliabilityPctFromStars(stars: 2 | 3 | 4 | 5): number {
  const map: Record<2 | 3 | 4 | 5, number> = { 2: 55, 3: 72, 4: 86, 5: 96 };
  return map[stars];
}

/** Confiabilidad a partir de una cantidad de observaciones/semanas frente a un máximo de referencia — usada donde no hay un objeto ConsistencyReliability disponible (p. ej. Referencia utilizada en modo personal). */
export function reliabilityPctFromObservations(observations: number, maxObservations = 6): number {
  const ratio = Math.max(0, Math.min(1, observations / maxObservations));
  return Math.round(30 + ratio * 65);
}

/** Etiqueta ejecutiva para un % de confianza — usada en tooltips y resúmenes de auditoría. */
export function confidenceLabel(pct: number): string {
  if (pct >= 90) return "Muy alta";
  if (pct >= 75) return "Alta";
  if (pct >= 55) return "Media";
  return "Baja";
}

/** Umbral mínimo de colaboradores del mismo cargo para habilitar comparación entre pares (§Sprint 7 — computeSmartBenchmark). Documentado aquí para que la copia de UI y el motor nunca queden desalineados. */
export const MIN_PEER_SAMPLE = 3;

/** Copia reutilizada cuando un factor cae en la regla de respaldo de Consistencia (§Analytics Engine — computeHealthScore/computePerformanceScore usan 70/100 como neutro cuando no hay semanas válidas suficientes) — ver Sprint 6.5 § S6.5-F. */
export const CONSISTENCY_FALLBACK_NOTE =
  "Actualmente no hay suficientes semanas con datos válidos para calcular la Consistencia real. Se utiliza temporalmente un puntaje neutro de 70/100 mientras se acumula historial. Este valor será reemplazado automáticamente cuando exista historial suficiente.";

/** Umbrales de clasificación compartidos por Performance Score y Equilibrio Operativo — mismo texto usado como "Referencia utilizada" en ambos audit summaries. */
export const SCORE_CLASSIFICATION_REFERENCE = "Clasificación por umbrales configurados: Excelente ≥90 · Bueno ≥75 · Riesgo ≥60 · Crítico <60";

// ── Sprint A: Ayuda contextual de 4 partes por indicador ─────────────────────
// Texto estático (sin cálculo, sin BD) redactado a partir de la sección
// "Objetivo" de cada indicador en docs/ANALYTICS_FORMULAS.md, en lenguaje
// simple — no describe nada que no sea ya el comportamiento real del motor.

export type IndicatorHelp = { meaning: string; howCalculated: string; whyItMatters: string; bestPractices: string[] };

export const INDICATOR_HELP: Record<string, IndicatorHelp> = {
  performanceScore: {
    meaning: "Qué tan bien se está ejecutando el trabajo este mes: combina cumplimiento, tareas vencidas, consistencia y evidencia documentada.",
    howCalculated: "Cada uno de esos 4 factores se convierte en un puntaje de 0 a 100 y se pondera según su peso configurado; la suma de los 4 aportes es el Performance Score.",
    whyItMatters: "Es el indicador principal de ejecución individual — a diferencia del Riesgo Operativo, nunca incluye carga de trabajo ni capacidad futura.",
    bestPractices: ["Cerrar las tareas dentro del plazo comprometido.", "Evitar acumular tareas vencidas, sobre todo de prioridad Alta.", "Mantener un ritmo de trabajo parejo semana a semana.", "Documentar el avance con comentarios y actividades a diario."],
  },
  riesgoOperativo: {
    meaning: "Qué tan riesgoso es seguir asignando trabajo nuevo a esta persona en este momento.",
    howCalculated: "Combina 8 señales independientes (sobrecarga proyectada, tareas críticas vencidas, tendencia de cumplimiento, horas extra, capacidad futura, variabilidad, concentración de actividades y falta de planificación), cada una ponderada.",
    whyItMatters: "Cuando sube a Alto o Crítico, se notifica automáticamente a los superiores — ayuda a decidir si conviene redistribuir trabajo antes de que se convierta en un problema.",
    bestPractices: ["Evitar acumular tareas de prioridad Alta vencidas.", "Definir el Tiempo Objetivo de las tareas antes de iniciarlas.", "Evitar horas extra sostenidas en fines de semana.", "Mantener un ritmo de trabajo estable."],
  },
  equilibrioOperativo: {
    meaning: "El equilibrio entre cumplimiento, carga laboral, gestión de tiempos, consistencia operativa y capacidad futura, en un solo número. No representa variables médicas, psicológicas ni psicosociales — es un indicador puramente operativo.",
    howCalculated: "5 dimensiones, cada una convertida a un puntaje 0-100 y ponderada — a diferencia del Performance Score, sí incluye carga laboral y capacidad futura.",
    whyItMatters: "Es el indicador más completo del motor: a diferencia del Performance Score (solo ejecución) combina también carga y capacidad, para dar una lectura integral de la operación.",
    bestPractices: ["Mantener la carga laboral dentro del rango óptimo.", "Cerrar tareas dentro del plazo.", "Conservar margen de capacidad para asumir trabajo nuevo."],
  },
  cargaLaboral: {
    meaning: "Cuánto se está trabajando realmente (horas reales registradas) frente a la base laboral esperada del período.",
    howCalculated: "Se ubica en una de 5 zonas — Subutilización, Moderado, Óptimo, Carga elevada o Sobrecarga — según cómo se compara con los límites configurados.",
    whyItMatters: "Tanto muy por debajo como muy por encima del rango óptimo son señales de atención — carga insuficiente y sobrecarga comparten el mismo color en el semáforo, hay que mirar la etiqueta, no solo el color.",
    bestPractices: ["Registrar las horas trabajadas de forma consistente.", "Avisar si la carga se siente sostenidamente alta o baja.", "Evitar que el trabajo se concentre en fines de semana."],
  },
  capacidadDisponible: {
    meaning: "Cuánta capacidad libre queda, proyectada hacia adelante (desde hoy hasta fin de mes), para asumir tareas nuevas.",
    howCalculated: "Resta el trabajo ya comprometido (tareas en progreso y pendientes con Tiempo Objetivo) de las horas laborales que quedan en el mes.",
    whyItMatters: "A diferencia de la Carga Laboral (que mira el mes ya transcurrido), esto ayuda a decidir si conviene o no asignar trabajo nuevo ahora mismo.",
    bestPractices: ["Definir el Tiempo Objetivo de las tareas pendientes.", "Registrar permisos o vacaciones planificadas con anticipación.", "Evitar comprometer más trabajo del que queda tiempo disponible."],
  },
  consistencia: {
    meaning: "Qué tan estable es el ritmo de trabajo semana a semana (horas, tareas completadas, cumplimiento).",
    howCalculated: "Se mide la variabilidad (coeficiente de variación) de esas 3 señales en las últimas semanas con datos válidos, y se convierte en un puntaje 0-100.",
    whyItMatters: "Un promedio bueno puede esconder semanas muy irregulares — este indicador detecta eso específicamente.",
    bestPractices: ["Evitar concentrar todo el trabajo en pocos días.", "Mantener un ritmo de registro diario.", "Planificar la semana para evitar picos y caídas fuertes."],
  },
  trazabilidad: {
    meaning: "Qué tan bien queda documentado el trabajo realizado — NO mide la calidad del trabajo en sí, solo su evidencia.",
    howCalculated: "Combina el % de días con registro (mitad del puntaje), comentarios del período y actividades documentadas (un cuarto cada uno).",
    whyItMatters: "Un buen trabajo sin evidencia registrada es difícil de auditar o de usar como referencia — este indicador incentiva dejar rastro del avance.",
    bestPractices: ["Registrar avance todos los días hábiles.", "Dejar comentarios en las tareas relevantes.", "Documentar actividades de seguimiento, no solo tareas."],
  },
  cumplimiento: {
    meaning: "Qué porcentaje de las tareas del período se completaron.",
    howCalculated: "Tareas completadas dividido por el total de tareas del período — puede verse en dos versiones según la pantalla: \"completado en cualquier momento\" o \"completado a tiempo\".",
    whyItMatters: "Es el factor con más peso dentro del Performance Score — refleja directamente cuánto del trabajo asignado se está terminando.",
    bestPractices: ["Priorizar el cierre de tareas próximas a vencer.", "Marcar como completada una tarea apenas se termine, no después.", "Revisar semanalmente las tareas pendientes."],
  },
  tiempoObjetivo: {
    meaning: "Qué tan cerca estuvo la ejecución real de una tarea del estándar operativo esperado (Tiempo Objetivo), no de una estimación subjetiva propia.",
    howCalculated: "Compara las horas reales trabajadas contra el Tiempo Objetivo validado (o el inicial, si no fue validado) y expresa el resultado como % de precisión.",
    whyItMatters: "Es un indicador adicional, no reemplaza al Performance Score ni al Riesgo Operativo — ayuda a calibrar qué tan realistas son los tiempos objetivo definidos.",
    bestPractices: ["Solicitar validación del Tiempo Objetivo antes de iniciar una tarea grande.", "Registrar las horas reales trabajadas con precisión.", "Avisar si un Tiempo Objetivo resulta sistemáticamente muy corto o muy largo."],
  },
};

export const CONFIDENCE_TOOLTIPS = {
  dataQuality: "Calidad del dato: qué tan completos y consistentes están los datos usados en este cálculo (registros, fechas, horas configuradas).",
  reliability: "Confiabilidad del cálculo: qué tan sólido es el resultado desde el punto de vista estadístico (tamaño de la muestra o del historial usado).",
  performanceScore: "Evalúa qué tan bien se ejecuta el trabajo.",
  operationalRisk: "Evalúa el riesgo de continuar asignando trabajo.",
  trazabilidad: "Mide qué tan bien quedó documentado el trabajo realizado.",
  consistencia: "Mide la estabilidad del desempeño entre períodos.",
  referenciaUtilizada: "Indica contra qué estándar se interpreta este indicador.",
  targetTimePrecision: "Mide qué tan cerca estuvo la ejecución real del Tiempo Objetivo esperado — no reemplaza al Performance Score.",
} as const;
