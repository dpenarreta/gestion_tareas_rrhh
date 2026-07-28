"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

/** Retención de archivado, tope de respuestas y presets de posposición — Sprint O (antes: literales 15/2/[15,30,60,1440] hardcodeados). */
export default function EscritorioDigitalConfigSection() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<{ archiveRetentionDays: number; maxReplies: number; snoozePresetsMinutes: number[] } | null>(null);
  const [retentionInput, setRetentionInput] = useState("15");
  const [maxRepliesInput, setMaxRepliesInput] = useState("2");
  const [snoozeInput, setSnoozeInput] = useState("15,30,60,1440");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/escritorio-digital-config");
      if (res.ok) {
        const data = await res.json();
        setCurrent(data);
        setRetentionInput(String(data.archiveRetentionDays));
        setMaxRepliesInput(String(data.maxReplies));
        setSnoozeInput(data.snoozePresetsMinutes.join(","));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleSave() {
    const retention = parseInt(retentionInput, 10);
    const maxReplies = parseInt(maxRepliesInput, 10);
    const snoozeMinutes = snoozeInput.split(",").map((s) => parseInt(s.trim(), 10));

    if (!Number.isInteger(retention) || retention < 1 || retention > 365) {
      showToast("La retención de archivado debe ser un entero entre 1 y 365 días", "error");
      return;
    }
    if (!Number.isInteger(maxReplies) || maxReplies < 1 || maxReplies > 20) {
      showToast("El tope de respuestas debe ser un entero entre 1 y 20", "error");
      return;
    }
    if (snoozeMinutes.length === 0 || snoozeMinutes.some((n) => !Number.isInteger(n) || n <= 0)) {
      showToast("Los presets de posposición deben ser minutos enteros positivos separados por coma", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/escritorio-digital-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveRetentionDays: retention, maxReplies, snoozePresetsMinutes: snoozeMinutes }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setCurrent(data);
        setSnoozeInput(data.snoozePresetsMinutes.join(","));
        showToast("Configuración de Escritorio Digital actualizada.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Escritorio Digital — configuración avanzada">
      {loading || !current ? (
        <SkeletonText lines={3} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Retención de archivado (días)</label>
              <p className="text-xs text-secondary">Días desde el archivado antes de eliminar una nota en duro.</p>
              <input
                type="number"
                min={1}
                max={365}
                value={retentionInput}
                onChange={(e) => setRetentionInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Tope de respuestas por nota</label>
              <p className="text-xs text-secondary">Máximo de respuestas cortas permitidas por conversación.</p>
              <input
                type="number"
                min={1}
                max={20}
                value={maxRepliesInput}
                onChange={(e) => setMaxRepliesInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Presets de posposición (minutos, separados por coma)</label>
              <p className="text-xs text-secondary">Ej: 15,30,60,1440 (1440 = un día).</p>
              <input
                type="text"
                value={snoozeInput}
                onChange={(e) => setSnoozeInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar configuración"}
          </Button>
        </>
      )}
    </SectionCard>
  );
}
