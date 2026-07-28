"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type SystemInfo = {
  version: string;
  commitSha: string | null;
  serverStartedAt: string;
  totalUsers: number;
  totalTasks: number;
  totalMeetings: number;
  totalIdeas: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Información del sistema + limpieza de intentos de login — extraído 1:1 de SettingsManager.tsx (Sprint O), sin cambios de lógica. */
export default function SystemInfoSection() {
  const { showToast } = useToast();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [loginAttemptCleanupLoading, setLoginAttemptCleanupLoading] = useState(false);

  const loadSystemInfo = useCallback(async () => {
    setInfoLoading(true);
    try {
      const res = await fetch("/api/settings/system-info");
      if (res.ok) setSystemInfo(await res.json());
    } finally {
      setInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(loadSystemInfo);
  }, [loadSystemInfo]);

  async function handleCleanupLoginAttempts() {
    setLoginAttemptCleanupLoading(true);
    try {
      const previewRes = await fetch("/api/settings/login-attempts/cleanup");
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        showToast(preview.error ?? "Error al calcular los registros a limpiar", "error");
        return;
      }
      if (preview.expiredCount === 0) {
        showToast("No hay intentos de login expirados para limpiar.", "info");
        return;
      }
      if (
        !confirm(
          `Se eliminarán ${preview.expiredCount} registro(s) de intentos de login expirados (sin bloqueo vigente, con más de 30 días de antigüedad). ¿Continuar?`
        )
      )
        return;

      const res = await fetch("/api/settings/login-attempts/cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al limpiar los intentos de login", "error");
      } else {
        showToast(`Se eliminaron ${data.deleted} registro(s) de intentos de login expirados.`, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setLoginAttemptCleanupLoading(false);
    }
  }

  return (
    <SectionCard title="Información del sistema">
      {infoLoading || !systemInfo ? (
        <SkeletonText lines={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-disabled">Versión de Nexo</p>
              <p className="text-sm font-medium text-title">
                {systemInfo.version}
                {systemInfo.commitSha && ` (${systemInfo.commitSha})`}
              </p>
            </div>
            <div>
              <p className="text-xs text-disabled">Último despliegue (aprox.)</p>
              <p className="text-sm font-medium text-title">{formatDate(systemInfo.serverStartedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Usuarios registrados</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalUsers}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Tareas en el sistema</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalTasks}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Reuniones registradas</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalMeetings}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Ideas en Mejora Continua</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalIdeas}</p>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-border">
            <Button variant="secondary" onClick={handleCleanupLoginAttempts} disabled={loginAttemptCleanupLoading}>
              {loginAttemptCleanupLoading ? "Calculando…" : "🗑️ Limpiar intentos de login expirados"}
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  );
}
