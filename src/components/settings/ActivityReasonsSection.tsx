"use client";

import { useState, useEffect, useCallback } from "react";
import { ROLE_LABEL, ALL_ROLES } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";

type Reason = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  assignedRoles: Role[];
};

function formatArchivedDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { year: "numeric", month: "short", day: "numeric" });
}

function RoleCheckboxGrid({ selected, onChange }: { selected: Role[]; onChange: (roles: Role[]) => void }) {
  function toggle(role: Role) {
    onChange(selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]);
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {ALL_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-1.5 text-xs text-main cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(role)}
            onChange={() => toggle(role)}
            className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
          />
          {ROLE_LABEL[role]}
        </label>
      ))}
    </div>
  );
}

function ReasonRow({ reason, onUpdated }: { reason: Reason; onUpdated: (r: Reason) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(reason.label);
  const [description, setDescription] = useState(reason.description ?? "");
  const [roles, setRoles] = useState<Role[]>(reason.assignedRoles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit() {
    setLabel(reason.label);
    setDescription(reason.description ?? "");
    setRoles(reason.assignedRoles);
    setError(null);
    setEditing(true);
  }

  async function save(patch: Partial<{ label: string; description: string | null; assignedRoles: Role[]; isActive: boolean; isArchived: boolean }>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/activity-reasons/${reason.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al guardar el motivo");
        return false;
      }
      onUpdated(data);
      return true;
    } catch {
      setError("Error de conexión");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!label.trim() || roles.length === 0) {
      setError("El nombre y al menos un rol son obligatorios");
      return;
    }
    const ok = await save({ label: label.trim(), description: description.trim() || null, assignedRoles: roles });
    if (ok) setEditing(false);
  }

  async function toggleActive() {
    await save({ isActive: !reason.isActive });
  }

  async function handleArchive() {
    if (!confirm(`¿Archivar el motivo "${reason.label}"? Podrás restaurarlo desde el Archivo.`)) return;
    await save({ isArchived: true });
  }

  if (editing) {
    return (
      <div className="border border-border rounded-lg p-3 space-y-2 bg-background">
        {error && <p className="text-xs text-danger">{error}</p>}
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <RoleCheckboxGrid selected={roles} onChange={setRoles} />
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 border border-border rounded-lg p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-title">{reason.label}</span>
          {!reason.isActive && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface2 text-disabled">
              Inactivo
            </span>
          )}
        </div>
        {reason.description && <p className="text-xs text-secondary mt-0.5">{reason.description}</p>}
        <p className="text-[11px] text-disabled mt-1">
          {reason.assignedRoles.map((r) => ROLE_LABEL[r]).join(", ")}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={openEdit} className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface">
          Editar
        </button>
        <button
          onClick={toggleActive}
          disabled={saving}
          className={`text-xs font-medium px-2 py-1 rounded disabled:opacity-50 ${
            reason.isActive ? "text-danger hover:bg-danger/[.09]" : "text-success hover:bg-success/[.13]"
          }`}
        >
          {reason.isActive ? "Desactivar" : "Activar"}
        </button>
        <button
          onClick={handleArchive}
          disabled={saving}
          className="text-xs font-medium px-2 py-1 rounded text-secondary hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        >
          Archivar
        </button>
      </div>
    </div>
  );
}

function ArchivedReasonRow({ reason, onRestored }: { reason: Reason; onRestored: (r: Reason) => void }) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/activity-reasons/${reason.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al restaurar el motivo");
      } else {
        onRestored(data);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
      <div className="min-w-0">
        <span className="text-sm font-medium text-title">{reason.label}</span>
        <p className="text-[11px] text-disabled mt-0.5">
          Archivado {reason.archivedAt ? formatArchivedDate(reason.archivedAt) : ""}
        </p>
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
      <button
        onClick={handleRestore}
        disabled={restoring}
        className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface disabled:opacity-50 shrink-0"
      >
        {restoring ? "Restaurando…" : "Restaurar"}
      </button>
    </div>
  );
}

export default function ActivityReasonsSection() {
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRoles, setNewRoles] = useState<Role[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/activity-reasons");
      if (res.ok) setReasons(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  async function handleCreate() {
    if (!newLabel.trim() || newRoles.length === 0) {
      setError("El nombre y al menos un rol son obligatorios");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/settings/activity-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), description: newDescription.trim() || null, assignedRoles: newRoles }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al crear el motivo");
      } else {
        setReasons((prev) => [...prev, data]);
        setNewLabel("");
        setNewDescription("");
        setNewRoles([]);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  function handleUpdated(updated: Reason) {
    setReasons((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  const activeReasons = reasons.filter((r) => !r.isArchived);
  const archivedReasons = reasons.filter((r) => r.isArchived);

  return (
    <SectionCard title="Motivos de actividades de seguimiento">
      {error && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
        </div>
      )}

      <div className="space-y-2 border border-border rounded-lg p-3">
        <p className="text-sm font-medium text-title">Crear motivo</p>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Nombre del motivo"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="text"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <RoleCheckboxGrid selected={newRoles} onChange={setNewRoles} />
        <div className="flex justify-end pt-1">
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creando…" : "Crear motivo"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-title">Motivos existentes</p>
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeReasons.length === 0 ? (
          <p className="text-sm text-disabled text-center py-6">No hay motivos registrados.</p>
        ) : (
          <div className="space-y-2">
            {activeReasons.map((r) => (
              <ReasonRow key={r.id} reason={r} onUpdated={handleUpdated} />
            ))}
          </div>
        )}
      </div>

      {!loading && archivedReasons.length > 0 && (
        <div className="pt-2 border-t border-border">
          <button
            onClick={() => setArchiveOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 text-sm font-medium text-main hover:text-primary transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${archiveOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
            Archivo ({archivedReasons.length})
          </button>
          {archiveOpen && (
            <div className="space-y-2 mt-2">
              {archivedReasons.map((r) => (
                <ArchivedReasonRow key={r.id} reason={r} onRestored={handleUpdated} />
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
