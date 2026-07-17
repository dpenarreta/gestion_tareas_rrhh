"use client";

import { useState, useEffect, useCallback } from "react";
import { ROLE_LABEL, ALL_ROLES } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "./SectionCard";

type Config = {
  commentTargets: Partial<Record<Role, Role[]>>;
  firstCommentRole: Role | null;
  retroactiveNotifyRoles: Role[];
};

function selectedOptions(select: HTMLSelectElement): Role[] {
  return Array.from(select.selectedOptions).map((o) => o.value as Role);
}

export default function NotificationRulesSection() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/notification-rules");
      if (res.ok) setConfig(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  async function handleSave() {
    if (!config) return;
    setMsg(null);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notification-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al guardar la configuración de notificaciones");
      } else {
        setConfig(data);
        setMsg("Configuración de notificaciones guardada.");
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Configuración de notificaciones">
      {loading || !config ? (
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {msg && (
            <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
              <span>{msg}</span>
              <button onClick={() => setMsg(null)} className="ml-2 text-success hover:brightness-90 font-bold">×</button>
            </div>
          )}
          {error && (
            <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-title mb-1">Notificaciones de comentarios en tareas</p>
            <p className="text-xs text-secondary mb-3">
              Para cada rol (fila), selecciona qué rol(es) reciben la notificación cuando ese rol comenta en una
              tarea. Mantén Ctrl/Cmd presionado para seleccionar varios.
            </p>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background">
                    <th className="text-left px-4 py-2.5 font-medium text-main">Rol que comenta</th>
                    <th className="text-left px-4 py-2.5 font-medium text-main">Notifica a</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ALL_ROLES.map((role) => (
                    <tr key={role}>
                      <td className="px-4 py-2.5 text-title font-medium whitespace-nowrap">{ROLE_LABEL[role]}</td>
                      <td className="px-4 py-2.5">
                        <select
                          multiple
                          size={3}
                          value={config.commentTargets[role] ?? []}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              commentTargets: { ...config.commentTargets, [role]: selectedOptions(e.target) },
                            })
                          }
                          className="w-full min-w-[220px] border border-border rounded-lg px-2 py-1 text-xs text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          {ALL_ROLES.filter((r) => r !== role).map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Primer comentario en tarea</label>
              <p className="text-xs text-secondary">Rol adicional notificado cuando es el primer comentario registrado en una tarea.</p>
              <select
                value={config.firstCommentRole ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, firstCommentRole: (e.target.value || null) as Role | null })
                }
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Desactivado</option>
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Respuesta en conversación activa</label>
              <p className="text-xs text-secondary">
                Se notifica siempre a los participantes del hilo (autor original + comentaristas previos). No es configurable.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="text-sm font-medium text-title">Registro retroactivo de horas</label>
            <p className="text-xs text-secondary">Roles que reciben notificación cuando alguien registra horas retroactivas.</p>
            <select
              multiple
              size={4}
              value={config.retroactiveNotifyRoles}
              onChange={(e) => setConfig({ ...config, retroactiveNotifyRoles: selectedOptions(e.target) })}
              className="w-full max-w-sm border border-border rounded-lg px-2 py-1 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Guardando…" : "Guardar configuración de notificaciones"}
          </button>
        </>
      )}
    </SectionCard>
  );
}
