"use client";

import { useState, useEffect, useCallback } from "react";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

/** Cuenta días lunes-viernes de un mes calendario (para la vista previa del cálculo mensual). */
function businessDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Configuración de Carga Laboral (4 límites del semáforo) — extraído 1:1 de SettingsManager.tsx (Sprint O), sin cambios de lógica. */
export default function WorkloadConfigSection() {
  const { showToast } = useToast();
  const [hoursPerDay, setHoursPerDay] = useState<number | null>(null);
  const [hoursInput, setHoursInput] = useState("6.30");
  const [workloadLimitLow, setWorkloadLimitLow] = useState<number | null>(null);
  const [limitLowInput, setLimitLowInput] = useState("5.30");
  const [workloadLimitHigh, setWorkloadLimitHigh] = useState<number | null>(null);
  const [limitHighInput, setLimitHighInput] = useState("7.30");
  const [workloadLimitOverload, setWorkloadLimitOverload] = useState<number | null>(null);
  const [limitOverloadInput, setLimitOverloadInput] = useState("8.30");
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hoursSaving, setHoursSaving] = useState(false);

  const loadHoursConfig = useCallback(async () => {
    setHoursLoading(true);
    try {
      const res = await fetch("/api/settings/workload-config");
      if (res.ok) {
        const data = await res.json();
        setHoursPerDay(data.hoursPerDay);
        setHoursInput(hoursToDisplay(data.hoursPerDay));
        setWorkloadLimitLow(data.workloadLimitLow);
        setLimitLowInput(hoursToDisplay(data.workloadLimitLow));
        setWorkloadLimitHigh(data.workloadLimitHigh);
        setLimitHighInput(hoursToDisplay(data.workloadLimitHigh));
        setWorkloadLimitOverload(data.workloadLimitOverload);
        setLimitOverloadInput(hoursToDisplay(data.workloadLimitOverload));
      }
    } finally {
      setHoursLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(loadHoursConfig);
  }, [loadHoursConfig]);

  async function handleSaveHours() {
    if (
      !validateDisplayHours(hoursInput) ||
      !validateDisplayHours(limitLowInput) ||
      !validateDisplayHours(limitHighInput) ||
      !validateDisplayHours(limitOverloadInput)
    ) {
      showToast(INVALID_HOURS_MESSAGE, "error");
      return;
    }
    const hoursValue = displayToHours(hoursInput);
    const limitLowValue = displayToHours(limitLowInput);
    const limitHighValue = displayToHours(limitHighInput);
    const limitOverloadValue = displayToHours(limitOverloadInput);
    setHoursSaving(true);
    try {
      const res = await fetch("/api/settings/workload-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hoursPerDay: hoursValue,
          workloadLimitLow: limitLowValue,
          workloadLimitHigh: limitHighValue,
          workloadLimitOverload: limitOverloadValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar la configuración", "error");
      } else {
        setHoursPerDay(data.hoursPerDay);
        setHoursInput(hoursToDisplay(data.hoursPerDay));
        setWorkloadLimitLow(data.workloadLimitLow);
        setLimitLowInput(hoursToDisplay(data.workloadLimitLow));
        setWorkloadLimitHigh(data.workloadLimitHigh);
        setLimitHighInput(hoursToDisplay(data.workloadLimitHigh));
        setWorkloadLimitOverload(data.workloadLimitOverload);
        setLimitOverloadInput(hoursToDisplay(data.workloadLimitOverload));
        showToast("Configuración de carga laboral actualizada.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setHoursSaving(false);
    }
  }

  return (
    <SectionCard title="Configuración de Carga Laboral">
      {hoursLoading || hoursPerDay === null ? (
        <SkeletonText lines={4} />
      ) : (
        <>
          <p className="text-xs text-secondary">
            4 límites definen los 5 rangos del semáforo de carga laboral. Cada uno se guarda por separado y debe
            mantener el orden: Subutilización &lt; Moderado/Óptimo &lt; Óptimo/Elevada &lt; Elevada/Sobrecarga.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Límite Subutilización / Moderado</label>
              <p className="text-xs text-secondary">Por debajo de este valor: Subutilización.</p>
              <input
                type="text"
                inputMode="decimal"
                value={limitLowInput}
                onChange={(e) => setLimitLowInput(e.target.value)}
                placeholder="ej: 5.30"
                className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Límite Rendimiento moderado / Rango óptimo</label>
              <p className="text-xs text-secondary">
                Por encima de este valor comienza el Rango óptimo. También define las horas de trabajo efectivo
                por día (base para el cálculo semanal y mensual).
              </p>
              <input
                type="text"
                inputMode="decimal"
                value={hoursInput}
                onChange={(e) => setHoursInput(e.target.value)}
                placeholder="ej: 6.30 = 6h 30min"
                className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Límite Óptimo / Carga elevada</label>
              <p className="text-xs text-secondary">Por encima de este valor: Carga elevada.</p>
              <input
                type="text"
                inputMode="decimal"
                value={limitHighInput}
                onChange={(e) => setLimitHighInput(e.target.value)}
                placeholder="ej: 7.30"
                className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Límite Carga elevada / Sobrecarga</label>
              <p className="text-xs text-secondary">Por encima de este valor: Sobrecarga.</p>
              <input
                type="text"
                inputMode="decimal"
                value={limitOverloadInput}
                onChange={(e) => setLimitOverloadInput(e.target.value)}
                placeholder="ej: 8.30"
                className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {(() => {
            if (
              !validateDisplayHours(hoursInput) ||
              !validateDisplayHours(limitLowInput) ||
              !validateDisplayHours(limitHighInput) ||
              !validateDisplayHours(limitOverloadInput)
            )
              return null;
            const preview = displayToHours(hoursInput);
            const lowPreview = displayToHours(limitLowInput);
            const highPreview = displayToHours(limitHighInput);
            const overloadPreview = displayToHours(limitOverloadInput);
            if (preview < 4 || preview > 8) return null;
            if (!(lowPreview < preview && preview <= highPreview && highPreview < overloadPreview)) {
              return (
                <div className="rounded-lg bg-danger/[.09] border border-danger/30 px-4 py-3 text-sm text-danger">
                  Los límites deben cumplir: Subutilización &lt; Horas efectivas ≤ Óptimo &lt; Sobrecarga.
                </div>
              );
            }
            const now = new Date();
            const bizDays = businessDaysInMonth(now.getFullYear(), now.getMonth() + 1);
            const monthLabel = now.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
            return (
              <div className="rounded-lg bg-background border border-border px-4 py-3 space-y-1.5 text-sm text-secondary">
                <p className="font-medium text-title">Rangos resultantes:</p>
                <p>🔴 Subutilización: menos de <span className="font-medium text-title">{hoursToDisplay(lowPreview)}</span></p>
                <p>🟡 Rendimiento moderado: de <span className="font-medium text-title">{hoursToDisplay(lowPreview)}</span> a <span className="font-medium text-title">{hoursToDisplay(preview)}</span></p>
                <p>🟢 Rango óptimo: de <span className="font-medium text-title">{hoursToDisplay(preview)}</span> a <span className="font-medium text-title">{hoursToDisplay(highPreview)}</span></p>
                <p>🟠 Carga elevada: de <span className="font-medium text-title">{hoursToDisplay(highPreview)}</span> a <span className="font-medium text-title">{hoursToDisplay(overloadPreview)}</span></p>
                <p>🔴 Sobrecarga: más de <span className="font-medium text-title">{hoursToDisplay(overloadPreview)}</span></p>
                <p className="pt-1.5 border-t border-border">Horas semanales: <span className="font-medium text-title">{hoursToDisplay(preview * 5)} horas</span> (5 días × {hoursToDisplay(preview)}h)</p>
                <p>
                  Horas mensuales: varía según días laborables (ej: {monthLabel} = {bizDays} días ×{" "}
                  {hoursToDisplay(preview)}h = <span className="font-medium text-title">{hoursToDisplay(preview * bizDays)} horas</span>)
                </p>
              </div>
            );
          })()}

          <Button
            onClick={handleSaveHours}
            disabled={
              hoursSaving ||
              (validateDisplayHours(hoursInput) &&
                validateDisplayHours(limitLowInput) &&
                validateDisplayHours(limitHighInput) &&
                validateDisplayHours(limitOverloadInput) &&
                displayToHours(hoursInput) === hoursPerDay &&
                displayToHours(limitLowInput) === workloadLimitLow &&
                displayToHours(limitHighInput) === workloadLimitHigh &&
                displayToHours(limitOverloadInput) === workloadLimitOverload)
            }
          >
            {hoursSaving ? "Guardando…" : "Guardar configuración"}
          </Button>
        </>
      )}
    </SectionCard>
  );
}
