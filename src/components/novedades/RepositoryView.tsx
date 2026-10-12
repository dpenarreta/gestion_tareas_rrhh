"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Skeleton";
import { formatDate, formatDateTime, novedadesApi } from "./api";
import { ErrorBox } from "./fields";
import type { RepositoryPeriod, SupervisorStatus } from "./types";
import type { ModuleContext } from "./NovedadesModule";

export default function RepositoryView({ ctx }: { ctx: ModuleContext }) {
  const [periods, setPeriods] = useState<RepositoryPeriod[] | null>(null);
  const [overview, setOverview] = useState<SupervisorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    novedadesApi.get<RepositoryPeriod[]>("repository").then((r) => {
      if (r.ok) setPeriods(r.data);
      else {
        setPeriods([]);
        setError(r.error);
      }
    });
  }, []);

  useEffect(() => {
    if (!ctx.me.nationalRead) return;
    novedadesApi.get<SupervisorStatus[]>("periods/status", { period: ctx.period }).then((r) => r.ok && setOverview(r.data));
  }, [ctx.me.nationalRead, ctx.period]);

  if (periods === null)
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-primary" />
      </div>
    );

  const closed = overview?.filter((s) => s.status === "CLOSED").length ?? 0;

  return (
    <div className="space-y-5">
      <ErrorBox message={error} />
      {overview && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-title">
            Avance del cierre nacional · {ctx.period} — {closed} de {overview.length} supervisores cerraron
          </h2>
          <div className="h-2 rounded-full bg-surface2 overflow-hidden">
            <div className="h-full bg-success" style={{ width: `${overview.length ? (closed / overview.length) * 100 : 0}%` }} />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {overview.map((s) => (
              <div key={s.supervisorId} className="border border-border rounded-lg p-2 text-sm flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{s.supervisorName}</div>
                  <div className="text-xs text-secondary">
                    {s.collaborators} colaboradores
                    {s.closedAt ? ` · cerrado ${formatDateTime(s.closedAt)} por ${s.closedBy}` : ""}
                  </div>
                </div>
                <Badge variant={s.status === "CLOSED" ? "neutral" : s.status === "OPEN" ? "success" : "warning"}>
                  {s.status === "CLOSED" ? "Cerrado" : s.status === "OPEN" ? "Abierto" : "Sin iniciar"}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {periods.length === 0 && <p className="text-sm text-secondary">Todavía no hay períodos registrados.</p>}
      {periods.map((p) => (
        <section key={p.code} className="border border-border rounded-xl bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div>
              <h3 className="font-semibold text-title">{p.label}</h3>
              <p className="text-xs text-secondary">
                {formatDate(p.startDate)} – {formatDate(p.endDate)}
              </p>
            </div>
          </header>
          <ul className="divide-y divide-border">
            {p.supervisors.map((s) => (
              <li key={s.supervisorId} className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium">{s.supervisorName}</span>{" "}
                  <Badge variant={s.status === "CLOSED" ? "neutral" : "success"}>{s.status === "CLOSED" ? "Cerrado" : "Abierto"}</Badge>
                  {s.closedAt && (
                    <span className="text-xs text-secondary">
                      {" "}
                      · {formatDateTime(s.closedAt)} por {s.closedBy}
                    </span>
                  )}
                  {s.summary?.activeCollaborators !== undefined && (
                    <div className="text-xs text-secondary">
                      {s.summary.activeCollaborators} colaboradores · {s.summary.workedHours} h laboradas ·{" "}
                      {s.summary.overtimeRecords} registros de horas extras ({s.summary.overtimeHours} h)
                    </div>
                  )}
                </div>
                <div className="flex gap-3 text-xs">
                  <button className="text-primary hover:underline" onClick={() => ctx.openPeriod(p.code, s.supervisorId)}>
                    Ver registros
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {p.corrections.length > 0 && (
            <div className="px-4 py-3 border-t border-border space-y-1">
              <h4 className="text-xs font-semibold text-secondary">Correcciones posteriores al cierre</h4>
              {p.corrections.map((c) => (
                <p key={c.id} className="text-xs">
                  {formatDateTime(c.createdAt)} · {c.correctedBy} · {c.target === "WORKED_DAY" ? "Días laborados" : "Horas extras"} (
                  {c.supervisorName}): {JSON.stringify(c.originalValues)} → {JSON.stringify(c.newValues)} — {c.reason}
                </p>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
