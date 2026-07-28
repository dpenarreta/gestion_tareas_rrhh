import SectionCard from "@/components/settings/SectionCard";

/**
 * Parámetros Globales — SOLO LECTURA en este sprint. Zona horaria de negocio,
 * primer día de semana y formato de fecha se consumen de forma SÍNCRONA en
 * el núcleo del Analytics Engine (analytics.ts, workload.ts, trendEngine.ts,
 * insightsEngine.ts, capacityForecast.ts) — volverlos editables exige el
 * mismo cambio de arquitectura (sync→async) que "días laborables", diferido
 * a un sprint dedicado (ver docs/ROADMAP.md). Idioma/moneda no se incluyen:
 * Nexo es 100% español hardcodeado sin librería i18n y no existe ningún
 * concepto de moneda en un sistema de RRHH — agregarlos sería configuración
 * sin consumidor real.
 */
export default function GlobalParamsSection() {
  return (
    <SectionCard title="Parámetros Globales">
      <p className="text-xs text-secondary">
        Estos valores son fijos en el código por ahora — mostrados aquí como referencia informativa,
        no editables. Volverlos configurables requiere un cambio de arquitectura (se leen de forma
        síncrona en el motor de Analytics) y queda planificado como sprint aparte.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-disabled">Zona horaria de negocio</p>
          <p className="text-sm font-medium text-title">UTC-5 (Ecuador/Colombia)</p>
        </div>
        <div>
          <p className="text-xs text-disabled">Primer día de la semana</p>
          <p className="text-sm font-medium text-title">Lunes</p>
        </div>
        <div>
          <p className="text-xs text-disabled">Formato de fecha</p>
          <p className="text-sm font-medium text-title">DD/MM/AAAA</p>
        </div>
      </div>
    </SectionCard>
  );
}
