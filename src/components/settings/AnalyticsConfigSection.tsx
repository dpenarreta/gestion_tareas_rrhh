"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast, TOAST_MESSAGES } from "@/components/ui/Toast";

type ConfigKey =
  | "healthWeightCumplimiento" | "healthWeightCarga" | "healthWeightVencidas" | "healthWeightConsistencia" | "healthWeightCapacidad"
  | "perfWeightCumplimiento" | "perfWeightVencidas" | "perfWeightConsistencia" | "perfWeightTrazabilidad"
  | "riskWeightSobrecarga" | "riskWeightVencidasCriticas" | "riskWeightTendenciaNegativa" | "riskWeightHorasExtra"
  | "riskWeightBajaCapacidad" | "riskWeightVariabilidad" | "riskWeightConcentracion" | "riskWeightSinPlanificacion"
  | "riskThresholdMedio" | "riskThresholdAlto" | "riskThresholdCritico"
  | "alertOverdueTaskThreshold" | "alertConsecutiveOverloadDays" | "anomalyVariationThresholdPct"
  | "cacheTtlMinutes" | "predictionMinWeeksMedia" | "predictionMinWeeksAlta";

type Config = Record<ConfigKey, number>;

const HEALTH_FIELDS: Array<{ key: ConfigKey; label: string }> = [
  { key: "healthWeightCumplimiento", label: "Cumplimiento" },
  { key: "healthWeightCarga", label: "Carga laboral" },
  { key: "healthWeightVencidas", label: "Tareas vencidas" },
  { key: "healthWeightConsistencia", label: "Consistencia" },
  { key: "healthWeightCapacidad", label: "Capacidad futura" },
];

const PERF_FIELDS: Array<{ key: ConfigKey; label: string }> = [
  { key: "perfWeightCumplimiento", label: "Cumplimiento" },
  { key: "perfWeightVencidas", label: "Tareas vencidas" },
  { key: "perfWeightConsistencia", label: "Consistencia" },
  { key: "perfWeightTrazabilidad", label: "Índice de Trazabilidad" },
];

const RISK_WEIGHT_FIELDS: Array<{ key: ConfigKey; label: string }> = [
  { key: "riskWeightSobrecarga", label: "Sobrecarga proyectada" },
  { key: "riskWeightVencidasCriticas", label: "Tareas críticas vencidas" },
  { key: "riskWeightTendenciaNegativa", label: "Tendencia negativa de cumplimiento" },
  { key: "riskWeightHorasExtra", label: "Horas extras recurrentes" },
  { key: "riskWeightBajaCapacidad", label: "Baja capacidad futura" },
  { key: "riskWeightVariabilidad", label: "Variabilidad entre semanas" },
  { key: "riskWeightConcentracion", label: "Concentración en un tipo de actividad" },
  { key: "riskWeightSinPlanificacion", label: "Tareas sin planificación" },
];

const RISK_THRESHOLD_FIELDS: Array<{ key: ConfigKey; label: string }> = [
  { key: "riskThresholdMedio", label: "Inicio de riesgo Medio" },
  { key: "riskThresholdAlto", label: "Inicio de riesgo Alto" },
  { key: "riskThresholdCritico", label: "Inicio de riesgo Crítico" },
];

const OTHER_FIELDS: Array<{ key: ConfigKey; label: string; suffix: string }> = [
  { key: "alertOverdueTaskThreshold", label: "Tareas vencidas que disparan alerta", suffix: "tareas" },
  { key: "alertConsecutiveOverloadDays", label: "Días consecutivos para alertar sobrecarga/subutilización", suffix: "días" },
  { key: "anomalyVariationThresholdPct", label: "Umbral de variación para detectar anomalías", suffix: "%" },
  { key: "cacheTtlMinutes", label: "Tiempo de caché de Analytics", suffix: "min" },
  { key: "predictionMinWeeksMedia", label: "Semanas mínimas para confianza Media en predicciones", suffix: "sem" },
  { key: "predictionMinWeeksAlta", label: "Semanas mínimas para confianza Alta en predicciones", suffix: "sem" },
];

function NumberField({
  label,
  value,
  onChange,
  suffix = "%",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-main">{label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 border border-border rounded-lg px-2 py-1 text-sm text-title bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <span className="text-xs text-disabled w-8">{suffix}</span>
      </span>
    </label>
  );
}

export default function AnalyticsConfigSection() {
  const { showToast } = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [predictionMaxDays, setPredictionMaxDays] = useState<number | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/analytics-config");
    if (res.ok) {
      const data = await res.json();
      setConfig(data.config);
      setDraft(data.config);
      setPredictionMaxDays(data.predictionMaxDays);
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  if (!config || !draft) {
    return (
      <SectionCard title="Configuración de Analytics">
        <div className="flex justify-center items-center py-8">
          <Spinner className="w-5 h-5" />
        </div>
      </SectionCard>
    );
  }

  const healthSum = HEALTH_FIELDS.reduce((s, f) => s + draft[f.key], 0);
  const perfSum = PERF_FIELDS.reduce((s, f) => s + draft[f.key], 0);
  const riskSum = RISK_WEIGHT_FIELDS.reduce((s, f) => s + draft[f.key], 0);
  const dirty = JSON.stringify(config) !== JSON.stringify(draft);

  function set(key: ConfigKey, value: number) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const changed = Object.fromEntries(
        (Object.entries(draft) as [ConfigKey, number][]).filter(([k, v]) => config![k] !== v)
      );
      const res = await fetch("/api/settings/analytics-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setConfig(data.config);
        setDraft(data.config);
        showToast(TOAST_MESSAGES.saved, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Configuración de Analytics">
      <p className="text-xs text-secondary">
        Umbrales y ponderaciones del motor de Analytics (Score de Salud Laboral, Índice de Riesgo Operativo, motor de
        alertas, predicción y caché). Cada cambio queda registrado en el historial de configuración con usuario, fecha
        y valor anterior. El límite máximo de predicción está fijo en {predictionMaxDays ?? 30} días — la precisión cae
        demasiado más allá de ese horizonte.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-semibold text-title">Performance Score — ponderaciones (Sprint 5)</h4>
            <span className={`text-xs font-medium ${Math.round(perfSum) === 100 ? "text-success" : "text-danger"}`}>Suma: {Math.round(perfSum * 10) / 10}%</span>
          </div>
          <div className="divide-y divide-border">
            {PERF_FIELDS.map((f) => (
              <NumberField key={f.key} label={f.label} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-semibold text-title">Score de Salud Laboral (Legacy) — ponderaciones</h4>
            <span className={`text-xs font-medium ${Math.round(healthSum) === 100 ? "text-success" : "text-danger"}`}>Suma: {Math.round(healthSum * 10) / 10}%</span>
          </div>
          <div className="divide-y divide-border">
            {HEALTH_FIELDS.map((f) => (
              <NumberField key={f.key} label={f.label} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-semibold text-title">Índice de Riesgo Operativo — ponderaciones</h4>
            <span className={`text-xs font-medium ${Math.round(riskSum) === 100 ? "text-success" : "text-danger"}`}>Suma: {Math.round(riskSum * 10) / 10}%</span>
          </div>
          <div className="divide-y divide-border">
            {RISK_WEIGHT_FIELDS.map((f) => (
              <NumberField key={f.key} label={f.label} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold text-title mb-1">Umbrales de clasificación del riesgo (0-100)</h4>
          <div className="divide-y divide-border">
            {RISK_THRESHOLD_FIELDS.map((f) => (
              <NumberField key={f.key} label={f.label} value={draft[f.key]} onChange={(v) => set(f.key, v)} suffix="pts" />
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-title mb-1">Alertas, anomalías, predicción y caché</h4>
          <div className="divide-y divide-border">
            {OTHER_FIELDS.map((f) => (
              <NumberField key={f.key} label={f.label} value={draft[f.key]} onChange={(v) => set(f.key, v)} suffix={f.suffix} />
            ))}
          </div>
        </div>
      </div>

      <Button onClick={save} disabled={saving || !dirty}>
        {saving ? "Guardando…" : "Guardar configuración"}
      </Button>
    </SectionCard>
  );
}
