"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type CurvePoint = { x: number; y: number };
type CurveName = "cumplimiento" | "vencidas" | "carga" | "capacidad" | "consistencia" | "trazabilidad";
type Curves = Record<CurveName, CurvePoint[]>;

const CURVE_LABEL: Record<CurveName, string> = {
  cumplimiento: "Cumplimiento",
  vencidas: "Tareas vencidas",
  carga: "Carga laboral (campana)",
  capacidad: "Capacidad disponible",
  consistencia: "Consistencia",
  trazabilidad: "Índice de Trazabilidad",
};

const CURVE_ORDER: CurveName[] = ["cumplimiento", "vencidas", "carga", "capacidad", "consistencia", "trazabilidad"];

function CurveEditor({
  name,
  points,
  onChange,
}: {
  name: CurveName;
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
}) {
  function setPoint(i: number, axis: "x" | "y", value: number) {
    onChange(points.map((p, idx) => (idx === i ? { ...p, [axis]: value } : p)));
  }
  function addPoint() {
    const last = points[points.length - 1] ?? { x: 0, y: 0 };
    onChange([...points, { x: last.x + 10, y: last.y }]);
  }
  function removePoint(i: number) {
    if (points.length <= 2) return;
    onChange(points.filter((_, idx) => idx !== i));
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs font-semibold text-title mb-2">{CURVE_LABEL[name]}</p>
      <div className="space-y-1.5">
        {points.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] text-disabled w-3">x</span>
            <input
              type="number"
              value={p.x}
              onChange={(e) => setPoint(i, "x", Number(e.target.value))}
              className="w-16 border border-border rounded-lg px-1.5 py-1 text-xs text-title bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-[10px] text-disabled w-3">y</span>
            <input
              type="number"
              min={0}
              max={100}
              value={p.y}
              onChange={(e) => setPoint(i, "y", Number(e.target.value))}
              className="w-16 border border-border rounded-lg px-1.5 py-1 text-xs text-title bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => removePoint(i)}
              disabled={points.length <= 2}
              className="text-disabled hover:text-danger disabled:opacity-30 text-xs px-1"
              aria-label="Eliminar punto"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addPoint}
        className="text-[11px] font-medium text-primary hover:text-primary-hover mt-2"
      >
        + Agregar punto de control
      </button>
    </div>
  );
}

/**
 * Editor de curvas del NormalizationEngine (§Sprint 5 S5-D/S5-E). Cada curva
 * es una lista de puntos (x=valor original, y=puntaje 0-100) — el motor
 * interpola linealmente entre ellos, así que agregar/mover puntos ajusta la
 * pendiente de penalización sin crear saltos abruptos. Mismo grupo de acceso
 * que "Configuración de Analytics".
 */
export default function NormalizationCurvesSection() {
  const { showToast } = useToast();
  const [curves, setCurves] = useState<Curves | null>(null);
  const [draft, setDraft] = useState<Curves | null>(null);
  const [savingName, setSavingName] = useState<CurveName | null>(null);
  const [successName, setSuccessName] = useState<CurveName | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/normalization-curves");
    if (res.ok) {
      const data = await res.json();
      setCurves(data.curves);
      setDraft(data.curves);
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  if (!curves || !draft) {
    return (
      <SectionCard title="Curvas de Normalización (NormalizationEngine)">
        <div className="flex justify-center items-center py-8">
          <Spinner className="w-5 h-5" />
        </div>
      </SectionCard>
    );
  }

  async function saveCurve(name: CurveName) {
    setSavingName(name);
    setSuccessName(null);
    try {
      const res = await fetch("/api/settings/normalization-curves", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, points: draft![name] }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setCurves(data.curves);
        setDraft(data.curves);
        setSuccessName(name);
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSavingName(null);
    }
  }

  return (
    <SectionCard title="Curvas de Normalización (NormalizationEngine)">
      <p className="text-xs text-secondary">
        Cada indicador se normaliza a un puntaje 0-100 mediante interpolación continua entre estos puntos de control —
        sin tablas rígidas ni saltos abruptos (§Sprint 5 S5-D). Los valores por defecto reproducen las reglas
        anteriores del motor. La curva de Carga sigue una forma de campana: el máximo debe quedar en el rango
        óptimo, y el Administrador decide si penaliza más la subutilización o la sobrecarga ajustando la pendiente
        de cada lado.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CURVE_ORDER.map((name) => {
          const dirty = JSON.stringify(curves[name]) !== JSON.stringify(draft[name]);
          return (
            <div key={name} className="space-y-2">
              <CurveEditor
                name={name}
                points={draft[name]}
                onChange={(points) => {
                  setDraft((prev) => (prev ? { ...prev, [name]: points } : prev));
                  setSuccessName(null);
                }}
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => saveCurve(name)}
                disabled={savingName === name || !dirty}
              >
                {savingName === name ? "Guardando…" : successName === name ? "Guardado ✓" : "Guardar curva"}
              </Button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
