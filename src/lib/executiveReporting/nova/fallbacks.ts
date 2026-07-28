// Executive Reporting Engine 2.0 — Fase C — fallbacks deterministas de NOVA.
// Mismo criterio que fallbackAnalytical/fallbackMotivational en
// kpis/nova-insights/[userId]/route.ts: SIEMPRE a partir de datos ya
// calculados (ExecutiveReportContext), nunca inventados — se usan cuando
// GROQ_API_KEY no está configurada, la llamada falla, excede el timeout, o
// la respuesta no viene en el formato esperado. La narrativa NUNCA queda en
// blanco (FPS Parte IV §8 — nunca bloquea/nunca falla la generación).
import type { ExecutiveReportContext } from "../context";
import type {
  NovaExecutiveAssessment,
  NovaExecutiveInsights,
  NovaExecutiveSummary,
  NovaRecommendationEnrichment,
} from "./types";
import type { Recommendation } from "@/lib/reportInsights";

export function fallbackExecutiveSummary(ctx: ExecutiveReportContext): NovaExecutiveSummary {
  const { avgCumplimiento, avgCargaPct, estadoGeneralNivel } = ctx.resumen;
  const situacionGeneral = estadoGeneralNivel
    ? `El equipo cierra el período en un nivel general "${estadoGeneralNivel}", con un cumplimiento promedio de ${avgCumplimiento}% y una carga laboral del ${avgCargaPct}%.`
    : `El equipo registra un cumplimiento promedio de ${avgCumplimiento}% y una carga laboral del ${avgCargaPct}% en el período evaluado.`;

  const fortalezas =
    ctx.destacado.mejor && ctx.destacado.mejor.completedPct >= 80
      ? `${ctx.destacado.mejor.name} lidera el desempeño del equipo con ${ctx.destacado.mejor.completedPct}% de cumplimiento.`
      : "No se identifican fortalezas destacables respaldadas por los datos de este período.";

  const aspectosAtencion =
    ctx.alertas.length > 0
      ? `Se registran ${ctx.alertas.length} alerta(s) activa(s), incluyendo a ${ctx.alertas[0].name} (${ctx.alertas[0].type === "cumplimiento" ? "cumplimiento" : "carga laboral"}: ${ctx.alertas[0].value}%).`
      : "No se registran alertas activas de cumplimiento o carga laboral en este período.";

  const conclusion =
    ctx.recomendaciones.length > 0
      ? `Se identifican ${ctx.recomendaciones.length} recomendación(es) accionable(s) para el próximo período (ver sección de Recomendaciones).`
      : "Los indicadores del equipo se mantienen dentro de rangos esperables; se sugiere mantener el seguimiento habitual.";

  return { situacionGeneral, fortalezas, aspectosAtencion, conclusion };
}

export function fallbackExecutiveInsights(ctx: ExecutiveReportContext): NovaExecutiveInsights {
  const { avgCumplimiento, avgCargaPct } = ctx.resumen;

  const patrones =
    ctx.distribucionTop.length > 0
      ? [`El motivo de consulta más frecuente concentra ${ctx.distribucionTop[0].pct ?? 0}% del total registrado.`]
      : ["Sin distribución de consultas suficiente para identificar un patrón en este período."];

  const cambioMensual = ctx.tendenciaMensual?.mesAnterior;
  const cambioRango = ctx.tendenciaRango;
  const cambios =
    cambioMensual && cambioMensual.direction !== "sin-datos"
      ? [`El cumplimiento del equipo ${cambioMensual.direction === "mejora" ? "mejoró" : cambioMensual.direction === "deterioro" ? "empeoró" : "se mantuvo estable"} respecto al mes anterior (${cambioMensual.compareValue}% → ${cambioMensual.currentValue}%).`]
      : cambioRango
        ? [`La tendencia del rango es "${cambioRango.cumplimientoTrend}" (${cambioRango.firstMonthAvgCumplimiento}% → ${cambioRango.lastMonthAvgCumplimiento}%).`]
        : ["La evidencia disponible no permite determinar una tendencia comparable en este período."];

  const anomalias = ["La evidencia disponible a nivel de equipo no permite determinar anomalías puntuales en este período."];

  const relacionesCruzadas: string[] = [];
  if (avgCumplimiento >= 80 && avgCargaPct >= 100) {
    relacionesCruzadas.push("El cumplimiento alto combinado con una carga laboral elevada sugiere un riesgo de sostenibilidad del ritmo actual.");
  } else if (avgCumplimiento < 60 && avgCargaPct < 80) {
    relacionesCruzadas.push("El cumplimiento bajo combinado con una carga laboral reducida sugiere un posible problema de productividad, no de capacidad.");
  } else {
    relacionesCruzadas.push("La evidencia disponible no permite establecer una relación cruzada concluyente entre cumplimiento y carga laboral en este período.");
  }

  return { patrones, cambios, anomalias, relacionesCruzadas };
}

export function fallbackExecutiveAssessment(ctx: ExecutiveReportContext): NovaExecutiveAssessment {
  const { avgCumplimiento, estadoGeneralNivel, dataQualityPct } = ctx.resumen;

  const diagnosticoGeneral = estadoGeneralNivel
    ? `El estado general del equipo se clasifica como "${estadoGeneralNivel}", con un cumplimiento promedio de ${avgCumplimiento}% y una calidad de datos del ${dataQualityPct}%.`
    : `El equipo registra un cumplimiento promedio de ${avgCumplimiento}% en el período evaluado, con una calidad de datos del ${dataQualityPct}%.`;

  const fortalezasEstrategicas = ctx.destacado.mejor
    ? [`${ctx.destacado.mejor.name} sostiene el mayor cumplimiento del equipo (${ctx.destacado.mejor.completedPct}%).`]
    : ["No se identifican fortalezas estratégicas respaldadas por los datos de este período."];

  const riesgosDetectados =
    ctx.alertas.length > 0
      ? ctx.alertas.slice(0, 3).map((a) => `${a.name}: ${a.type === "cumplimiento" ? `cumplimiento de ${a.value}%, por debajo del umbral operativo` : `carga laboral de ${a.value}%, por encima del rango óptimo`}.`)
      : ["No se detectan riesgos activos respaldados por los datos de este período."];

  const oportunidades = ["La evidencia disponible no permite cuantificar una oportunidad de retorno específico en este período."];

  const prioridades =
    ctx.recomendaciones.filter((r) => r.priority === "alta").length > 0
      ? ctx.recomendaciones.filter((r) => r.priority === "alta").map((r) => r.text)
      : ["Mantener el seguimiento habitual de los indicadores del equipo."];

  const perspectivaEstrategica =
    "La evidencia disponible respalda un seguimiento continuo de los indicadores actuales; una proyección más amplia requiere datos adicionales de períodos futuros.";

  const opinionEjecutiva = ctx.destacado.atencion
    ? `La operación mantiene un desempeño ${avgCumplimiento >= 70 ? "adecuado" : "que requiere atención"}; ${ctx.destacado.atencion.name} representa el caso que más beneficio obtendría de una intervención priorizada en el próximo período.`
    : `La operación mantiene un desempeño ${avgCumplimiento >= 70 ? "adecuado" : "que requiere atención"} en el período evaluado.`;

  return { diagnosticoGeneral, fortalezasEstrategicas, riesgosDetectados, oportunidades, prioridades, perspectivaEstrategica, opinionEjecutiva };
}

const PRIORITY_IMPACT: Record<Recommendation["priority"], string> = {
  alta: "Reduce un riesgo operativo de corto plazo si se ejecuta en el próximo período.",
  media: "Contribuye a una mejora gradual del indicador asociado.",
};

const PRIORITY_TIMEFRAME: Record<Recommendation["priority"], string> = {
  alta: "Inmediato — próximos 7 días.",
  media: "Mediano plazo — próximas 2 a 4 semanas.",
};

const PRIORITY_COMPLEXITY: Record<Recommendation["priority"], string> = {
  alta: "Media — requiere coordinar la redistribución con las personas involucradas.",
  media: "Baja — ajuste dentro de la operación habitual del equipo.",
};

export function fallbackRecommendationEnrichment(recommendations: Recommendation[]): NovaRecommendationEnrichment[] {
  return recommendations.map((r) => ({
    id: r.id,
    justificacion: r.text,
    impactoEsperado: PRIORITY_IMPACT[r.priority],
    areaAfectada: "Operación del equipo.",
    beneficio: r.priority === "alta" ? "Mitiga un riesgo operativo identificado." : "Sostiene la mejora continua del equipo.",
    complejidadEstimada: PRIORITY_COMPLEXITY[r.priority],
    tiempoEstimado: PRIORITY_TIMEFRAME[r.priority],
    responsableSugerido: "Coordinación del equipo.",
  }));
}
