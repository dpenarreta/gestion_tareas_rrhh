"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

const RETENTION_LOGIN_ATTEMPTS_OPTIONS = ["7", "15", "30", "60", "90"];

type Config = {
  passwordMinLength: number;
  sessionDurationDefaultHours: number;
  sessionDurationRememberHours: number;
  retentionLoginAttemptsDays: string;
};

/** Longitud mínima de contraseña, duración de sesión y retención de intentos de login — Sprint O. */
export default function SeguridadConfigSection() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<Config | null>(null);
  const [pwdInput, setPwdInput] = useState("6");
  const [defaultHoursInput, setDefaultHoursInput] = useState("168");
  const [rememberHoursInput, setRememberHoursInput] = useState("720");
  const [retentionInput, setRetentionInput] = useState("30");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/seguridad-config");
      if (res.ok) {
        const data: Config = await res.json();
        setCurrent(data);
        setPwdInput(String(data.passwordMinLength));
        setDefaultHoursInput(String(data.sessionDurationDefaultHours));
        setRememberHoursInput(String(data.sessionDurationRememberHours));
        setRetentionInput(data.retentionLoginAttemptsDays);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function handleSave() {
    const pwd = parseInt(pwdInput, 10);
    const defaultHours = parseInt(defaultHoursInput, 10);
    const rememberHours = parseInt(rememberHoursInput, 10);

    if (!Number.isInteger(pwd) || pwd < 4 || pwd > 128) {
      showToast("La longitud mínima de contraseña debe ser un entero entre 4 y 128", "error");
      return;
    }
    if (!Number.isInteger(defaultHours) || defaultHours < 1 || defaultHours > 8760) {
      showToast("La duración de sesión debe ser un entero entre 1 y 8760 horas", "error");
      return;
    }
    if (!Number.isInteger(rememberHours) || rememberHours < 1 || rememberHours > 8760) {
      showToast("La duración de sesión (recordarme) debe ser un entero entre 1 y 8760 horas", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/seguridad-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passwordMinLength: pwd,
          sessionDurationDefaultHours: defaultHours,
          sessionDurationRememberHours: rememberHours,
          retentionLoginAttemptsDays: retentionInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setCurrent(data);
        showToast("Configuración de Seguridad actualizada.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Seguridad — configuración">
      {loading || !current ? (
        <SkeletonText lines={4} />
      ) : (
        <>
          <p className="text-xs text-secondary">
            La duración de sesión solo afecta sesiones NUEVAS — las ya emitidas conservan su expiración original.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Longitud mínima de contraseña</label>
              <input
                type="number"
                min={4}
                max={128}
                value={pwdInput}
                onChange={(e) => setPwdInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Duración de sesión (horas)</label>
              <input
                type="number"
                min={1}
                max={8760}
                value={defaultHoursInput}
                onChange={(e) => setDefaultHoursInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Duración de sesión &quot;recordarme&quot; (horas)</label>
              <input
                type="number"
                min={1}
                max={8760}
                value={rememberHoursInput}
                onChange={(e) => setRememberHoursInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Retener intentos de login por</label>
              <select
                value={retentionInput}
                onChange={(e) => setRetentionInput(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {RETENTION_LOGIN_ATTEMPTS_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v} días</option>
                ))}
              </select>
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
