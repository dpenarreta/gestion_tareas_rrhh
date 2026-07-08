"use client";

import { useState, useEffect, useCallback } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  dataConsentAccepted: boolean;
  dataConsentAcceptedAt: string | null;
};

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

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <h3 className="font-semibold text-title">{title}</h3>
      {children}
    </div>
  );
}

export default function SettingsManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, []);

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
    queueMicrotask(loadUsers);
    queueMicrotask(loadSystemInfo);
  }, [loadUsers, loadSystemInfo]);

  async function handleResetConsent(user: User) {
    if (
      !confirm(
        `¿Deseas que ${user.name} vea nuevamente el aviso de protección de datos en su próximo login?`
      )
    )
      return;
    setMsg(null);
    setError(null);
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-consent`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al restablecer el consentimiento");
      } else {
        setMsg(`Se restableció el aviso de protección de datos para ${user.name}.`);
        loadUsers();
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetConsentAll() {
    if (
      !confirm(
        "¿Deseas restablecer el consentimiento de protección de datos de TODOS los usuarios? Todos verán nuevamente el aviso en su próximo login."
      )
    )
      return;
    if (
      !confirm(
        "Esta acción afecta a todos los usuarios del sistema y no se puede deshacer. ¿Confirmas que deseas continuar?"
      )
    )
      return;
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/users/reset-consent-all", { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al restablecer el consentimiento");
      } else {
        setMsg(`Se restableció el consentimiento de ${data.count} usuario(s).`);
        loadUsers();
      }
    } catch {
      setError("Error de conexión");
    }
  }

  async function handleResetPassword(user: User) {
    setMsg(null);
    setError(null);
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al resetear");
      } else {
        setMsg(data.message);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="ml-2 text-success hover:brightness-90 font-bold">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">
            ×
          </button>
        </div>
      )}

      <SectionCard title="Consentimiento de datos">
        <div className="flex justify-end">
          <button
            onClick={handleResetConsentAll}
            className="px-4 py-2 border border-border hover:bg-black/5 dark:hover:bg-white/5 text-main font-medium rounded-lg text-sm transition-colors"
          >
            🔄 Restablecer todos
          </button>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-4 py-2.5 font-medium text-main">Usuario</th>
                  <th className="text-left px-4 py-2.5 font-medium text-main">Estado</th>
                  <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 text-title font-medium">
                      {u.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.dataConsentAccepted ? (
                        <span className="px-2.5 py-1 bg-success/[.13] text-success rounded-full text-xs font-medium">
                          Aceptado
                          {u.dataConsentAcceptedAt && ` · ${formatDate(u.dataConsentAcceptedAt)}`}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-surface2 text-secondary rounded-full text-xs font-medium">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleResetConsent(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors disabled:opacity-50"
                      >
                        🔄 Restablecer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Gestión de contraseñas">
        <div className="rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-4 py-2.5 font-medium text-main">Usuario</th>
                  <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 text-title font-medium">
                      {u.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleResetPassword(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-warning hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-warning/[.15] transition-colors disabled:opacity-50"
                        title="Resetear contraseña a 123456"
                      >
                        🔑 Resetear contraseña
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Información del sistema">
        {infoLoading || !systemInfo ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
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
        )}
      </SectionCard>
    </div>
  );
}
