"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import type { PredictionsBundle } from "./types";

const CLASS_STYLE: Record<string, string> = {
  "Muy Alta": "text-success",
  Alta: "text-success",
  Media: "text-warning",
  Baja: "text-orange-600 dark:text-orange-400",
  "Muy Baja": "text-danger",
};

/** Bloque 10 — Estabilidad Operativa: exclusivamente predictivo, no modifica ningún KPI existente. */
export default function OperationalStabilityCard({ userId }: { userId: string }) {
  const [data, setData] = useState<PredictionsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/predictive/predictions/${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4 flex justify-center">
        <Spinner className="w-4 h-4 text-primary" />
      </div>
    );
  }
  if (!data) return null;

  const { estabilidad } = data;

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5">Estabilidad Operativa</p>
      <p className={`text-2xl font-bold ${CLASS_STYLE[estabilidad.classification] ?? "text-title"}`}>{estabilidad.classification}</p>
      <p className="text-[11px] text-disabled mt-1">CV promedio: {estabilidad.averageCoefficientOfVariation}%</p>
      {estabilidad.basedOn.length > 0 && (
        <p className="text-[11px] text-disabled mt-1">Mayor variabilidad en: {estabilidad.basedOn.join(", ")}</p>
      )}
    </div>
  );
}
