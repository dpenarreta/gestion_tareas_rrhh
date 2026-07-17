"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ROLE_LABEL, ALL_ROLES } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "./SectionCard";

type Config = {
  commentTargets: Partial<Record<Role, Role[]>>;
  firstCommentRole: Role | null;
  retroactiveNotifyRoles: Role[];
};

/**
 * Multi-select de roles como popover de checkboxes (no <select multiple> nativo,
 * cuya única forma de "vaciar" es Ctrl/Cmd+clic, poco descubrible). Incluye
 * "Nadie" como opción explícita que vacía la selección; marcar cualquier rol
 * la desmarca automáticamente (es un checkbox derivado de selected.length === 0,
 * no un valor almacenado aparte).
 */
function RoleMultiSelect({
  roles,
  selected,
  onChange,
}: {
  roles: Role[];
  selected: Role[];
  onChange: (roles: Role[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const isNone = selected.length === 0;

  function toggleRole(r: Role) {
    onChange(selected.includes(r) ? selected.filter((x) => x !== r) : [...selected, r]);
  }

  const summary = isNone ? "Nadie" : selected.map((r) => ROLE_LABEL[r]).join(", ");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={summary}
        className={`w-full min-w-[200px] text-left border border-border rounded-lg px-3 py-1.5 text-xs bg-surface hover:border-primary/50 transition-colors truncate ${
          isNone ? "text-disabled italic" : "text-title"
        }`}
      >
        {summary}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-60 max-h-72 overflow-y-auto bg-surface border border-border rounded-lg shadow-xl p-2 space-y-0.5">
          <label className="flex items-center gap-2 text-xs font-semibold text-danger cursor-pointer px-2 py-1.5 rounded hover:bg-danger/[.09]">
            <input
              type="checkbox"
              checked={isNone}
              onChange={() => onChange([])}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Nadie
          </label>
          <div className="border-t border-border my-1" />
          {roles.map((r) => (
            <label
              key={r}
              className="flex items-center gap-2 text-xs text-main cursor-pointer px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={selected.includes(r)}
                onChange={() => toggleRole(r)}
                className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
              />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
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
              tarea. Elige &ldquo;Nadie&rdquo; para desactivar la notificación de ese rol.
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
                        <RoleMultiSelect
                          roles={ALL_ROLES.filter((r) => r !== role)}
                          selected={config.commentTargets[role] ?? []}
                          onChange={(roles) =>
                            setConfig({ ...config, commentTargets: { ...config.commentTargets, [role]: roles } })
                          }
                        />
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
            <RoleMultiSelect
              roles={ALL_ROLES}
              selected={config.retroactiveNotifyRoles}
              onChange={(roles) => setConfig({ ...config, retroactiveNotifyRoles: roles })}
            />
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
