"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { LineChart } from "lucide-react";
import { NivelBadge, ReliabilityBadge, ExplainBlock } from "./badges";
import type { PredictionsBundle } from "./types";

/** Bloques 3, 4 y 6 (nivel tarea) — Predicción de Cumplimiento, Sobrecarga y Retrasos de tareas propias. */
export default function PredictionCards({ userId }: { userId: string }) {
  const [data, setData] = useState<PredictionsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/predictive/predictions/${userId}`);
        if (!res.ok) throw new Error("failed");
        const json = await res.json();
        if (!cancelled) setData(json);
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
      <div className="flex justify-center py-8">
        <Spinner className="w-5 h-5 text-primary" />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState icon={LineChart} title="No se pudieron cargar las predicciones" />;
  }

  const { cumplimiento, sobrecarga, taskDelays } = data;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5">Proyección de Cumplimiento</p>
          {cumplimiento.available ? (
            <>
              <p className="text-2xl font-bold text-title">{cumplimiento.cumplimientoEsperadoCierrePct}%</p>
              <p className={`text-xs font-medium ${cumplimiento.variacionEsperadaPct >= 0 ? "text-success" : "text-danger"}`}>
                Variación esperada: {cumplimiento.variacionEsperadaPct >= 0 ? "+" : ""}
                {cumplimiento.variacionEsperadaPct}%
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[11px] text-disabled">Confianza: {cumplimiento.confidencePct}%</span>
                <ReliabilityBadge reliability={cumplimiento.historicalReliability} />
              </div>
              <p className="text-[11px] text-disabled mt-0.5">Histórico utilizado: {cumplimiento.historicalWindowWeeks} semanas · Horizonte: {cumplimiento.horizon} días</p>
              <ExplainBlock prediction={cumplimiento} />
            </>
          ) : (
            <p className="text-xs text-disabled italic">{cumplimiento.reason}</p>
          )}
        </div>

        <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Predicción de Sobrecarga</p>
            {sobrecarga.available && <NivelBadge nivel={sobrecarga.nivel} />}
          </div>
          {sobrecarga.available ? (
            <>
              <p className="text-2xl font-bold text-title">{sobrecarga.probabilidadPct}%</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[11px] text-disabled">Confianza: {sobrecarga.confidencePct}%</span>
                <ReliabilityBadge reliability={sobrecarga.historicalReliability} />
              </div>
              <p className="text-[11px] text-disabled mt-0.5">Horizonte: {sobrecarga.horizon} días</p>
              <ExplainBlock prediction={sobrecarga} />
            </>
          ) : (
            <p className="text-xs text-disabled italic">{sobrecarga.reason}</p>
          )}
        </div>
      </div>

      {taskDelays.length > 0 && (
        <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Predicción de Retrasos — tareas propias</p>
          <div className="divide-y divide-border">
            {taskDelays.map(({ taskId, title, prediction }) => (
              <div key={taskId} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-title truncate">{title}</p>
                  {prediction.available && prediction.motivos.length > 0 && (
                    <p className="text-[11px] text-secondary mt-0.5">Motivos: {prediction.motivos.join(", ")}</p>
                  )}
                </div>
                {prediction.available ? (
                  <div className="text-right shrink-0">
                    <NivelBadge nivel={prediction.nivel} />
                    <p className="text-[11px] text-disabled mt-0.5">{prediction.probabilidadPct}%</p>
                  </div>
                ) : (
                  <span className="text-[11px] text-disabled italic shrink-0">{prediction.reason}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
