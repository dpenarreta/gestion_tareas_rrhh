"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

/** TTL de caché de mensajes generados por NOVA (Dashboard + Insights) — Sprint O (antes: literal 4h duplicado en 2 archivos). */
export default function NovaCacheSection() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<number | null>(null);
  const [input, setInput] = useState("240");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/nova-cache");
      if (res.ok) {
        const data = await res.json();
        setCurrent(data.cacheTtlMinutes);
        setInput(String(data.cacheTtlMinutes));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleSave() {
    const value = parseInt(input, 10);
    if (!Number.isInteger(value) || value < 1 || value > 10080) {
      showToast("El TTL de caché debe ser un entero entre 1 y 10080 minutos (7 días)", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/nova-cache", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cacheTtlMinutes: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setCurrent(data.cacheTtlMinutes);
        showToast("TTL de caché de NOVA actualizado.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="NOVA — caché de mensajes">
      {loading || current === null ? (
        <SkeletonText lines={2} />
      ) : (
        <>
          <p className="text-xs text-secondary">
            Tiempo (en minutos) que NOVA reutiliza un mensaje ya generado (mensaje del Dashboard e Insights de
            Analytics) antes de volver a llamar al modelo de IA.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-title">TTL de caché (minutos)</label>
            <input
              type="number"
              min={1}
              max={10080}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <Button onClick={handleSave} disabled={saving || Number(input) === current}>
            {saving ? "Guardando…" : "Guardar configuración"}
          </Button>
        </>
      )}
    </SectionCard>
  );
}
