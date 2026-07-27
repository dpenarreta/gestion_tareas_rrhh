"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast, TOAST_MESSAGES } from "@/components/ui/Toast";

function windowLabel(v: string): string {
  return `${v} semanas`;
}

export default function PredictionWindowSection() {
  const { showToast } = useToast();
  const [options, setOptions] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/prediction-window");
      if (res.ok) {
        const data = await res.json();
        setOptions(data.options ?? []);
        setSaved(data.windowWeeks);
        setDraft(data.windowWeeks);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/prediction-window", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowWeeks: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setSaved(data.windowWeeks);
        setDraft(data.windowWeeks);
        showToast(TOAST_MESSAGES.saved, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading || draft === null) {
    return (
      <SectionCard title="Configuración Predictiva">
        <div className="flex justify-center items-center py-8">
          <Spinner className="w-5 h-5" />
        </div>
      </SectionCard>
    );
  }

  const dirty = draft !== saved;

  return (
    <SectionCard title="Configuración Predictiva">
      <p className="text-xs text-secondary">
        Ventana histórica que usa el motor predictivo (Trend Engine y Predicciones) para calcular tendencias y
        proyecciones — un único valor para toda la plataforma. Cada predicción muestra el histórico analizado con
        este mismo valor.
      </p>

      <div className="max-w-xs space-y-1.5">
        <label className="text-sm font-medium text-title">Ventana Histórica de Predicción</label>
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {options.map((v) => (
            <option key={v} value={v}>
              {windowLabel(v)}
            </option>
          ))}
        </select>
      </div>

      <Button onClick={save} disabled={saving || !dirty}>
        {saving ? "Guardando…" : "Guardar configuración"}
      </Button>
    </SectionCard>
  );
}
