"use client";

import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ROLE_LABEL, ROLE_LEVEL, getSubordinateRoles } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import type { ReportData, RangeReportData, PeriodReportData, ReportMemberKpi } from "../types";
import {
  ALL_WIZARD_SECTIONS,
  WIZARD_SECTION_LABEL,
  type WizardSectionKey,
  type WizardFormat,
  normalizeMonthReport,
  normalizeRangeReport,
  normalizeCustomReport,
  downloadWizardPDF,
  downloadWizardExcel,
} from "./wizardExport";

type RosterUser = { id: string; name: string; role: Role };

type PeriodPreset = "mes-actual" | "mes-anterior" | "ultimos-30" | "trimestre" | "semestre" | "año" | "personalizado";

const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  "mes-actual": "Mes actual",
  "mes-anterior": "Mes anterior",
  "ultimos-30": "Últimos 30 días",
  trimestre: "Trimestre (últimos 3 meses)",
  semestre: "Semestre (últimos 6 meses)",
  "año": "Año (últimos 12 meses)",
  personalizado: "Rango personalizado",
};

const DEFAULT_SECTIONS: WizardSectionKey[] = ["resumen", "kpis", "equilibrio", "ranking", "tendencias", "consultas", "hallazgos", "recomendaciones", "detalle", "anexos"];

function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function addMonthsToParam(base: string, n: number) {
  let [y, m] = base.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthParamLabel(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ResolvedPeriod =
  | { kind: "month"; month: string; label: string }
  | { kind: "range"; from: string; to: string; label: string }
  | { kind: "custom"; from: string; to: string; label: string };

function resolvePeriod(preset: PeriodPreset, customFrom: string, customTo: string): ResolvedPeriod | null {
  const current = currentMonthParam();
  switch (preset) {
    case "mes-actual":
      return { kind: "month", month: current, label: monthParamLabel(current) };
    case "mes-anterior": {
      const m = addMonthsToParam(current, -1);
      return { kind: "month", month: m, label: monthParamLabel(m) };
    }
    case "trimestre": {
      const from = addMonthsToParam(current, -2);
      return { kind: "range", from, to: current, label: `${monthParamLabel(from)} — ${monthParamLabel(current)}` };
    }
    case "semestre": {
      const from = addMonthsToParam(current, -5);
      return { kind: "range", from, to: current, label: `${monthParamLabel(from)} — ${monthParamLabel(current)}` };
    }
    case "año": {
      const from = addMonthsToParam(current, -11);
      return { kind: "range", from, to: current, label: `${monthParamLabel(from)} — ${monthParamLabel(current)}` };
    }
    case "ultimos-30": {
      const to = new Date();
      const from = new Date(to.getTime() - 29 * 86400000);
      return { kind: "custom", from: isoDate(from), to: isoDate(to), label: `${isoDate(from)} a ${isoDate(to)}` };
    }
    case "personalizado":
      if (!customFrom || !customTo) return null;
      return { kind: "custom", from: customFrom, to: customTo, label: `${customFrom} a ${customTo}` };
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  currentUserRole: Role;
  /** Datos del informe ya cargado en pantalla (si hay) — usado solo para que los filtros rápidos de colaboradores ("con actividad"/"riesgo"/"destacados") tengan datos reales sin disparar un cálculo nuevo. */
  referenceMembers: ReportMemberKpi[];
};

export function ReportWizardModal({ open, onClose, currentUserRole, referenceMembers }: Props) {
  const { showToast } = useToast();
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<PeriodPreset>("mes-actual");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sections, setSections] = useState<Set<WizardSectionKey>>(new Set(DEFAULT_SECTIONS));
  const [format, setFormat] = useState<WizardFormat>("pdf-completo");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    function loadRoster() {
      setRosterLoading(true);
      fetch("/api/users")
        .then((r) => r.json())
        .then((users: Array<{ id: string; name: string; role: Role }>) => {
          const executors = users.filter((u) => ROLE_LEVEL[u.role] < 4);
          setRoster(executors);
          setSelectedIds(new Set(executors.map((u) => u.id)));
        })
        .finally(() => setRosterLoading(false));
    }
    queueMicrotask(loadRoster);
  }, [open]);

  if (!open) return null;

  const referenceById = new Map(referenceMembers.map((m) => [m.id, m]));
  const hasReference = referenceMembers.length > 0;

  function applyQuickFilter(filter: "todos" | "mi-equipo" | "actividad" | "riesgo" | "destacados" | "activos") {
    if (filter === "todos" || filter === "activos") {
      setSelectedIds(new Set(roster.map((u) => u.id)));
      return;
    }
    if (filter === "mi-equipo") {
      const subRoles = new Set(getSubordinateRoles(currentUserRole));
      setSelectedIds(new Set(roster.filter((u) => subRoles.has(u.role)).map((u) => u.id)));
      return;
    }
    if (!hasReference) {
      showToast("Genera un informe primero para usar filtros basados en datos del período", "error");
      return;
    }
    if (filter === "actividad") {
      setSelectedIds(new Set(roster.filter((u) => {
        const ref = referenceById.get(u.id);
        return ref && (ref.totalTasks > 0 || ref.seguimientoTotal > 0);
      }).map((u) => u.id)));
    } else if (filter === "riesgo") {
      setSelectedIds(new Set(roster.filter((u) => {
        const ref = referenceById.get(u.id);
        return ref && (ref.cargaLabel === "Sobrecarga" || ref.cargaLabel === "Carga elevada" || ref.completedPct < 60);
      }).map((u) => u.id)));
    } else if (filter === "destacados") {
      setSelectedIds(new Set(roster.filter((u) => {
        const ref = referenceById.get(u.id);
        return ref?.estadoOperativo && (ref.estadoOperativo.estado === "Equilibrio Óptimo" || ref.estadoOperativo.estado === "Equilibrio Estable");
      }).map((u) => u.id)));
    }
  }

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSection(key: WizardSectionKey) {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleGenerate() {
    const resolved = resolvePeriod(preset, customFrom, customTo);
    if (!resolved) {
      showToast("Selecciona un rango de fechas válido", "error");
      return;
    }
    if (selectedIds.size === 0) {
      showToast("Selecciona al menos un colaborador", "error");
      return;
    }
    const allSelected = selectedIds.size === roster.length;
    const userIdsParam = allSelected ? "" : `&userIds=${[...selectedIds].join(",")}`;

    setGenerating(true);
    try {
      let normalized;
      if (resolved.kind === "month") {
        const res = await fetch(`/api/reports/generate?month=${resolved.month}${userIdsParam}`, { method: "POST" });
        if (!res.ok) throw new Error((await res.json()).error ?? "Error al generar el informe");
        const { report } = (await res.json()) as { report: { data: ReportData } };
        normalized = normalizeMonthReport(report.data, resolved.label);
      } else if (resolved.kind === "range") {
        const res = await fetch(`/api/reports/range?from=${resolved.from}&to=${resolved.to}${userIdsParam}`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Error al generar el informe");
        const { report } = (await res.json()) as { report: RangeReportData };
        normalized = normalizeRangeReport(report, resolved.label);
      } else {
        const res = await fetch(`/api/reports/custom-range?from=${resolved.from}&to=${resolved.to}${userIdsParam}`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Error al generar el informe");
        const { report } = (await res.json()) as { report: PeriodReportData };
        normalized = normalizeCustomReport(report);
      }

      if (format === "excel") {
        downloadWizardExcel(normalized, sections);
      } else {
        downloadWizardPDF(normalized, sections, format === "pdf-ejecutivo" ? "ejecutivo" : "completo");
      }
      showToast("Informe generado.", "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al generar el informe", "error");
    } finally {
      setGenerating(false);
    }
  }

  const resolved = resolvePeriod(preset, customFrom, customTo);
  const tendenciasDisabled = resolved?.kind !== "month";

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader title="Generador Inteligente de Reportes" onClose={onClose} />
      <div className="p-6 space-y-6">
        {/* Colaboradores */}
        <section>
          <h3 className="text-sm font-semibold text-title mb-2">Colaboradores</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {([
              ["todos", "Seleccionar todos"],
              ["mi-equipo", "Solo mi equipo"],
              ["actividad", "Solo con actividad"],
              ["riesgo", "Solo con riesgo operativo"],
              ["destacados", "Solo destacados"],
              ["activos", "Solo colaboradores activos"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyQuickFilter(key)}
                className="text-[11px] px-2.5 py-1 rounded-full border border-border text-secondary hover:bg-surface2 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
          {rosterLoading ? (
            <div className="flex justify-center py-6"><Spinner className="w-5 h-5 text-primary" /></div>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-border rounded-xl divide-y divide-border">
              {roster.map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface2">
                  <input type="checkbox" checked={selectedIds.has(u.id)} onChange={() => toggleMember(u.id)} className="rounded border-border" />
                  <span className="text-main">{u.name}</span>
                  <span className="text-[11px] text-disabled ml-auto">{ROLE_LABEL[u.role]}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-[11px] text-disabled mt-1">{selectedIds.size} de {roster.length} colaboradores seleccionados.</p>
        </section>

        {/* Período */}
        <section>
          <h3 className="text-sm font-semibold text-title mb-2">Período</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(Object.keys(PERIOD_PRESET_LABEL) as PeriodPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors text-left ${preset === p ? "border-primary bg-primary-surface text-primary font-medium" : "border-border text-secondary hover:bg-surface2"}`}
              >
                {PERIOD_PRESET_LABEL[p]}
              </button>
            ))}
          </div>
          {preset === "personalizado" && (
            <div className="flex gap-3 mt-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-secondary font-medium">Desde</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-secondary font-medium">Hasta</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-main" />
              </div>
            </div>
          )}
          {resolved && <p className="text-[11px] text-disabled mt-2">Período resuelto: {resolved.label}</p>}
        </section>

        {/* Secciones */}
        <section>
          <h3 className="text-sm font-semibold text-title mb-2">Secciones a incluir</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ALL_WIZARD_SECTIONS.map((key) => {
              const disabled = key === "tendencias" && tendenciasDisabled;
              return (
                <label key={key} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg ${disabled ? "opacity-40" : "cursor-pointer hover:bg-surface2"}`}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={sections.has(key) && !disabled}
                    onChange={() => toggleSection(key)}
                    className="rounded border-border"
                  />
                  <span className="text-main">{WIZARD_SECTION_LABEL[key]}</span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Formato */}
        <section>
          <h3 className="text-sm font-semibold text-title mb-2">Formato de exportación</h3>
          <div className="flex flex-wrap gap-2">
            {([
              ["pdf-ejecutivo", "PDF Ejecutivo"],
              ["pdf-completo", "PDF Completo"],
              ["excel", "Excel"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFormat(key)}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors ${format === key ? "border-primary bg-primary-surface text-primary font-medium" : "border-border text-secondary hover:bg-surface2"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {format === "pdf-ejecutivo" && (
            <p className="text-[11px] text-disabled mt-2">El PDF Ejecutivo siempre incluye Resumen, KPIs, Equilibrio, Ranking, Hallazgos y Recomendaciones (versión condensada para dirección), sin importar las secciones tildadas arriba.</p>
          )}
        </section>
      </div>
      <div className="px-6 py-4 border-t border-border flex justify-end gap-2 sticky bottom-0 bg-surface">
        <Button variant="secondary" onClick={onClose} disabled={generating}>Cancelar</Button>
        <Button variant="primary" onClick={handleGenerate} disabled={generating}>
          {generating ? (<><Spinner className="w-3.5 h-3.5 text-white" /> Generando...</>) : "Generar informe"}
        </Button>
      </div>
    </Modal>
  );
}
