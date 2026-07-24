"use client";

import { useState, useEffect } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { HelpPopover } from "./AdvancedAnalytics";
import { INDICATOR_HELP } from "@/lib/analyticsExplain";
import { PRECISION_CLASS_COLOR, type PrecisionClassification } from "@/lib/targetTime";

type TargetTimePrecisionResponse =
  | { available: false; reason: string; engineVersion: string; lastUpdated: string }
  | {
      available: true;
      avgPrecisionPct: number;
      classification: PrecisionClassification;
      sampleSize: number;
      validatedPct: number;
      engineVersion: string;
      lastUpdated: string;
    };

/**
 * Precisión del Tiempo Objetivo (§Sprint 6 S6-F) — NUEVO KPI, aditivo. No
 * reemplaza al Performance Score ni a ningún otro indicador; es un insumo
 * candidato para versiones futuras del motor.
 */
export default function TargetTimePrecisionCard({ userId }: { userId: string }) {
  const [data, setData] = useState<TargetTimePrecisionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/analytics/target-time/${userId}`);
        if (!res.ok) throw new Error("failed");
        if (!cancelled) setData(await res.json());
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5 flex justify-center py-8">
        <Spinner className="w-5 h-5 text-primary" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-disabled text-center py-6">No se pudo cargar la Precisión del Tiempo Objetivo.</div>;
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-main uppercase tracking-wider flex items-center gap-1.5">
          Precisión del Tiempo Objetivo <HelpPopover title="Precisión del Tiempo Objetivo" help={INDICATOR_HELP.tiempoObjetivo} />
        </h3>
      </div>
      <p className="text-[10px] font-semibold text-primary bg-primary-surface inline-block px-2 py-0.5 rounded-full mb-3">
        Nuevo — no reemplaza al Performance Score
      </p>

      {!data.available ? (
        <p className="text-sm text-disabled italic">{data.reason}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={`text-3xl font-extrabold ${PRECISION_CLASS_COLOR[data.classification]}`}>{data.avgPrecisionPct}%</span>
            <span className={`text-sm font-semibold ${PRECISION_CLASS_COLOR[data.classification]}`}>{data.classification}</span>
          </div>
          <p className="text-xs text-secondary">
            {data.sampleSize} {data.sampleSize === 1 ? "tarea completada este mes" : "tareas completadas este mes"} con horas reales registradas
          </p>
          <p className="text-[11px] text-disabled mt-1.5 pt-1.5 border-t border-border">
            {data.validatedPct}% de la muestra usó el Tiempo Objetivo Validado como referencia — el resto usó el Tiempo Objetivo Inicial (§S6-H).
          </p>
        </>
      )}
    </div>
  );
}
