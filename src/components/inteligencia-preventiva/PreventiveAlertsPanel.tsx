"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { severityMeta } from "./badges";
import type { PreventiveAlert } from "./types";

/** Bloque 7 — Inteligencia Preventiva: alertas priorizadas 🔴🟠🟡🟢. */
export default function PreventiveAlertsPanel({ endpoint, title }: { endpoint: string; title: string }) {
  const [alerts, setAlerts] = useState<PreventiveAlert[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(endpoint);
        const json = res.ok ? await res.json() : { alerts: [] };
        if (!cancelled) setAlerts(json.alerts ?? []);
      } catch {
        if (!cancelled) setAlerts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{title}</p>
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner className="w-4 h-4 text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {(alerts ?? []).map((a, i) => {
            const meta = severityMeta(a.severity);
            return (
              <div key={i} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${meta.className}`}>
                <span aria-hidden className="text-base leading-none">
                  {meta.emoji}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-title">{a.message}</p>
                  <p className="text-[10px] text-disabled mt-0.5">
                    {meta.label} · {a.source}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
