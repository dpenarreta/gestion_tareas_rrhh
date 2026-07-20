"use client";

import { useState } from "react";
import SectionCard from "./SectionCard";
import { formatDate } from "@/lib/utils";

type Diagnostics = {
  kpisCalculados: number;
  kpisDesdeCache: number;
  kpisRecalculados: number;
  tiempoCalculoTotalMs: number;
  validacionesEjecutadas: number;
  validacionesFallidas: number;
  calidadGlobalDatos: number;
  tiempoRenderizadoMs: number;
  engineVersion: string;
  formulaSetVersion: string;
  formulaVersions: Record<string, string>;
  featureFlags: Record<string, boolean>;
  versionChange: { previousVersion: string | null; changed: boolean };
  serverStartedAt: string;
  ultimaActualizacion: string;
};

const FORMULA_LABEL: Record<string, string> = {
  cargaLaboral: "Carga laboral",
  scoreSalud: "Score de Salud (Legacy)",
  performanceScore: "Performance Score",
  scoreSimple: "Score simple",
  capacidadDisponible: "Capacidad disponible",
  riesgoOperativo: "Riesgo Operativo",
  cumplimiento: "Cumplimiento",
  consistencia: "Consistencia",
  trazabilidad: "Índice de Trazabilidad",
  prediccion: "Predicción",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-disabled">{label}</p>
      <p className="text-sm font-medium text-title">{value}</p>
    </div>
  );
}

/** Botón "🔧 Diagnóstico del Motor" — solo Administrador (§S3-D). Nunca visible para otros roles. */
export default function EngineDiagnosticsSection() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDiagnostics() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/diagnostics");
      if (!res.ok) throw new Error("No se pudo obtener el diagnóstico");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al obtener el diagnóstico");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Diagnóstico del Motor de Analytics">
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary">
          Reporte interno del motor centralizado (caché, validaciones, calidad de datos) — solo visible para Administrador.
        </p>
        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="shrink-0 px-4 py-2 border border-border hover:bg-black/5 dark:hover:bg-white/5 text-main font-medium rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {loading ? "Calculando…" : "🔧 Diagnóstico del Motor"}
        </button>
      </div>

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      {data?.versionChange.changed && (
        <p className="text-xs text-primary bg-primary-surface rounded-lg px-3 py-2 mt-3">
          ℹ Versión del motor actualizada{data.versionChange.previousVersion ? ` de v${data.versionChange.previousVersion}` : ""} a v{data.engineVersion} — registrado en auditoría.
        </p>
      )}

      {data && (
        <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Stat label="KPIs calculados en este ciclo" value={data.kpisCalculados} />
          <Stat label="KPIs desde caché" value={data.kpisDesdeCache} />
          <Stat label="KPIs recalculados" value={data.kpisRecalculados} />
          <Stat label="Tiempo de cálculo total" value={`${data.tiempoCalculoTotalMs}ms`} />
          <Stat label="Validaciones ejecutadas" value={data.validacionesEjecutadas} />
          <Stat
            label="Validaciones fallidas"
            value={data.validacionesFallidas > 0 ? `⚠ ${data.validacionesFallidas}` : "0"}
          />
          <Stat label="Calidad global de datos" value={`${data.calidadGlobalDatos}%`} />
          <Stat label="Tiempo de esta petición" value={`${data.tiempoRenderizadoMs}ms`} />
          <Stat label="Versión del motor" value={`Analytics Engine v${data.engineVersion}`} />
          <Stat label="Versión de fórmulas" value={`v${data.formulaSetVersion}`} />
          <Stat label="Proceso activo desde" value={formatDate(data.serverStartedAt)} />
          <Stat label="Última actualización" value={new Date(data.ultimaActualizacion).toLocaleString("es-CL")} />
        </div>
      )}

      {data && (
        <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-disabled mb-1.5">Versión de fórmulas</p>
            <ul className="space-y-0.5">
              {Object.entries(data.formulaVersions).map(([key, version]) => (
                <li key={key} className="text-xs text-secondary flex justify-between max-w-xs">
                  <span>{FORMULA_LABEL[key] ?? key}</span>
                  <span className="font-mono text-title">v{version}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs text-disabled mb-1.5">Feature flags activas</p>
            <ul className="space-y-0.5">
              {Object.entries(data.featureFlags).map(([key, enabled]) => (
                <li key={key} className="text-xs text-secondary flex justify-between max-w-xs">
                  <span>{key}</span>
                  <span className={enabled ? "text-success font-semibold" : "text-disabled"}>{enabled ? "ON" : "OFF"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
