"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { TrendingUp } from "lucide-react";
import { DirectionBadge } from "./badges";
import type { TrendEngineResponse } from "./types";

/** Bloque 1 — Trend Engine: evolución de los 8 indicadores en la ventana configurada por el Administrador. */
export default function TrendOverviewCards({ userId }: { userId: string }) {
  const [data, setData] = useState<TrendEngineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/predictive/trend/${userId}`);
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
    return <EmptyState icon={TrendingUp} title="No se pudo cargar el Trend Engine" />;
  }

  const indicators = Object.values(data.indicators);

  return (
    <div className="space-y-3">
      <p className="text-xs text-disabled">
        Histórico analizado: {data.windowWeeks} {data.windowWeeks === 1 ? "semana" : "semanas"}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {indicators.map((ind) => (
          <div key={ind.indicator} className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5">{ind.label}</p>
            {ind.available ? (
              <>
                <DirectionBadge direction={ind.direction} />
                <p className="text-[11px] text-disabled mt-2">
                  Último valor: <span className="text-title font-medium">{ind.dataPoints[ind.dataPoints.length - 1]?.value ?? "—"}</span>
                </p>
                <p className="text-[11px] text-disabled">Variabilidad (CV): {ind.coefficientOfVariation}%</p>
              </>
            ) : (
              <p className="text-xs text-disabled italic">{ind.reason ?? "Sin historial suficiente"}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
