"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

/** Ventana de registro retroactivo + hora de corte de jornada — Sprint O (antes: literales 2 y 17 hardcodeados). */
export default function TrabajoAvanzadoSection() {
  const { showToast } = useToast();
  const [retroactiveWindowDays, setRetroactiveWindowDays] = useState<number | null>(null);
  const [workdayEndHour, setWorkdayEndHour] = useState<number | null>(null);
  const [windowInput, setWindowInput] = useState("2");
  const [hourInput, setHourInput] = useState("17");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/trabajo-avanzado");
      if (res.ok) {
        const data = await res.json();
        setRetroactiveWindowDays(data.retroactiveWindowDays);
        setWindowInput(String(data.retroactiveWindowDays));
        setWorkdayEndHour(data.workdayEndHour);
        setHourInput(String(data.workdayEndHour));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleSave() {
    const windowValue = parseInt(windowInput, 10);
    const hourValue = parseInt(hourInput, 10);
    if (!Number.isInteger(windowValue) || windowValue < 1 || windowValue > 10) {
      showToast("La ventana de registro retroactivo debe ser un entero entre 1 y 10 días", "error");
      return;
    }
    if (!Number.isInteger(hourValue) || hourValue < 0 || hourValue > 23) {
      showToast("La hora de corte de jornada debe ser un entero entre 0 y 23", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/trabajo-avanzado", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retroactiveWindowDays: windowValue, workdayEndHour: hourValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setRetroactiveWindowDays(data.retroactiveWindowDays);
        setWorkdayEndHour(data.workdayEndHour);
        showToast("Configuración de Trabajo actualizada.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Trabajo — configuración avanzada">
      {loading || retroactiveWindowDays === null ? (
        <SkeletonText lines={2} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Ventana de registro retroactivo (días hábiles)</label>
              <p className="text-xs text-secondary">Días hábiles hacia atrás en los que Seguimiento/Proyectos permiten registrar horas de forma retroactiva.</p>
              <input
                type="number"
                min={1}
                max={10}
                value={windowInput}
                onChange={(e) => setWindowInput(e.target.value)}
                className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Hora de corte de jornada (0-23)</label>
              <p className="text-xs text-secondary">Hora local (huso de negocio) a la que Capacidad Proyectada asume terminada la jornada del día.</p>
              <input
                type="number"
                min={0}
                max={23}
                value={hourInput}
                onChange={(e) => setHourInput(e.target.value)}
                className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || (Number(windowInput) === retroactiveWindowDays && Number(hourInput) === workdayEndHour)}
          >
            {saving ? "Guardando…" : "Guardar configuración"}
          </Button>
        </>
      )}
    </SectionCard>
  );
}
