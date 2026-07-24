"use client";

import { useState } from "react";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";

type QualityItem = { id: string; label: string };
type QualityCheck = { key: string; label: string; count: number; items: QualityItem[]; note?: string };
type QualityReport = { generatedAt: string; totalIssues: number; checks: QualityCheck[] };

function CheckRow({ check }: { check: QualityCheck }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssues = check.count > 0;

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-title">{check.label}</p>
          {check.note && <p className="text-xs text-disabled mt-0.5">{check.note}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
              hasIssues ? "bg-danger/[.13] text-danger" : "bg-success/[.13] text-success"
            }`}
          >
            {check.count}
          </span>
          {hasIssues && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-primary hover:text-primary-hover font-medium"
            >
              {expanded ? "Ocultar" : "Ver"}
            </button>
          )}
        </div>
      </div>
      {expanded && hasIssues && (
        <ul className="mt-2 space-y-1 pl-1">
          {check.items.map((item) => (
            <li key={item.id} className="text-xs text-secondary">
              · {item.label}
            </li>
          ))}
          {check.count > check.items.length && (
            <li className="text-xs text-disabled">… y {check.count - check.items.length} más</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Informe interno de calidad del dato (Sprint D §9) — bajo demanda, solo lectura, solo Administrador. */
export default function DataQualitySection() {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/data-quality");
      if (!res.ok) throw new Error("No se pudo generar el informe");
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar el informe");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Calidad del Dato">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Verificaciones automáticas de solo lectura (horas duplicadas, fechas inválidas, referencias rotas,
          registros sin propietario, cálculos fuera de rango) — no corrige nada, solo reporta.
        </p>
        <Button variant="secondary" className="shrink-0" onClick={runCheck} disabled={loading}>
          {loading ? "Verificando…" : "Verificar calidad del dato"}
        </Button>
      </div>

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      {report && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-disabled mb-2">
            {report.totalIssues === 0 ? "Sin hallazgos" : `${report.totalIssues} hallazgo${report.totalIssues !== 1 ? "s" : ""}`} ·
            generado {new Date(report.generatedAt).toLocaleString("es-CL")}
          </p>
          <div>
            {report.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
