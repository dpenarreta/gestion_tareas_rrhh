"use client";

import { useState, useEffect, useCallback } from "react";
import type { Role } from "@/lib/roles";
import { ALL_ROLES, ROLE_LABEL } from "@/lib/roles";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast, TOAST_MESSAGES } from "@/components/ui/Toast";

type NexoRole = { id: string; name: string; permissionCodenames: string[] };
type PermissionModule = { label: string; description: string; permissions: Record<string, string> };
type PermissionCatalog = Record<string, PermissionModule>;

const DEFAULT_SELECTED_ROLE: Role = "JEFE_NACIONAL";

/**
 * "Roles y Permisos" (`/admin/roles`) — matriz de permisos por rol sobre el
 * catálogo dinámico extendido a todo el sistema (ver docs/AUDIT_LOG.md §
 * 2026-09-01). Layout de 2 columnas (roles a la izquierda, matriz del rol
 * seleccionado a la derecha) en vez del patrón de cards de
 * `RoleCompatibilitySection` — la matriz acá es sustancialmente más grande
 * (~19 módulos), un rol a la vez escala mejor.
 *
 * Restringido a EDITAR permisos de los 11 roles fijos de Nexo — no
 * crea/elimina roles pese a que el backend lo soporta (ver
 * docs/DECISIONS.md): `Role` es un union type TS fijo, un `Group` fuera de
 * esa lista rompería en runtime en el resto del frontend.
 */
export default function RolesPermissionsManager({
  canEdit,
  currentSessionRole,
}: {
  canEdit: boolean;
  currentSessionRole: Role;
}) {
  const { showToast } = useToast();
  const [roles, setRoles] = useState<NexoRole[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>(DEFAULT_SELECTED_ROLE);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    const [rolesRes, catalogRes] = await Promise.all([
      fetch("/api/admin/roles"),
      fetch("/api/admin/permissions"),
    ]);
    if (rolesRes.ok) {
      const data: NexoRole[] = await rolesRes.json();
      // Solo los 11 roles fijos de Nexo — un `Group` ajeno (ej. el
      // "Superusuario" heredado del template) no tiene ROLE_LABEL/ROLE_LEVEL
      // y no debe aparecer acá (ver docstring del componente).
      const nexoRoles = data.filter((r) => (ALL_ROLES as string[]).includes(r.name));
      setRoles(nexoRoles);
      const initial = nexoRoles.find((r) => r.name === DEFAULT_SELECTED_ROLE);
      if (initial) setDraft(new Set(initial.permissionCodenames));
    }
    if (catalogRes.ok) {
      setCatalog(await catalogRes.json());
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  if (!roles || !catalog) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner className="w-5 h-5" />
      </div>
    );
  }

  const allCodenames = Object.values(catalog).flatMap((m) => Object.keys(m.permissions));
  const isAdministrador = selectedRole === "ADMINISTRADOR";
  // ADMINISTRADOR bypasea TODO vía `is_superuser` (ver
  // apps/hierarchy/migrations/0002_seed_nexo_roles.py) — se muestra con
  // todo tildado y sin edición, para no dar la falsa impresión de que
  // destildar algo acá lo restringe de verdad.
  const effectiveSelected = isAdministrador ? new Set(allCodenames) : draft;

  const savedRole = roles.find((r) => r.name === selectedRole);
  const savedCodenames = new Set(savedRole?.permissionCodenames ?? []);
  const dirty =
    !isAdministrador &&
    (draft.size !== savedCodenames.size || [...draft].some((c) => !savedCodenames.has(c)));

  function selectRole(name: Role) {
    setSelectedRole(name);
    const role = roles!.find((r) => r.name === name);
    setDraft(new Set(role?.permissionCodenames ?? []));
  }

  function toggle(codename: string) {
    if (isAdministrador || !canEdit) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(codename)) next.delete(codename);
      else next.add(codename);
      return next;
    });
  }

  const selfLockoutWarning =
    currentSessionRole === selectedRole &&
    !isAdministrador &&
    !draft.has("roles.ver") &&
    savedCodenames.has("roles.ver");

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/roles/${savedRole!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionCodenames: [...draft] }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setRoles((prev) => prev!.map((r) => (r.id === data.id ? data : r)));
        showToast(TOAST_MESSAGES.saved, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      <div className="space-y-1">
        {ALL_ROLES.map((name) => (
          <button
            key={name}
            onClick={() => selectRole(name)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedRole === name
                ? "bg-primary text-white font-semibold"
                : "text-main hover:bg-surface2"
            }`}
          >
            {ROLE_LABEL[name]}
          </button>
        ))}
      </div>

      <div className="border border-border rounded-xl p-4 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-title">
            Permisos de {ROLE_LABEL[selectedRole]}
          </h3>
          {canEdit && !isAdministrador && (
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!dirty || saving}
              className="shrink-0 px-3 py-1.5 bg-primary text-white font-medium rounded-lg text-xs hover:bg-primary-hover disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              Guardar
            </button>
          )}
        </div>

        {isAdministrador && (
          <p className="text-xs text-secondary bg-surface2 rounded-lg px-3 py-2">
            El Administrador tiene acceso total al sistema (superusuario) — no editable desde
            acá.
          </p>
        )}

        <div className="space-y-4">
          {Object.entries(catalog).map(([moduleKey, module]) => {
            const codenames = Object.keys(module.permissions);
            const selectedCount = codenames.filter((c) => effectiveSelected.has(c)).length;
            return (
              <div key={moduleKey}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-title">{module.label}</p>
                  <span className="text-[11px] text-disabled">
                    {selectedCount} de {codenames.length}
                  </span>
                </div>
                {module.description && (
                  <p className="text-[11px] text-secondary mb-1.5">{module.description}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {codenames.map((codename) => (
                    <label
                      key={codename}
                      className="flex items-center gap-1.5 text-xs text-main cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={effectiveSelected.has(codename)}
                        onChange={() => toggle(codename)}
                        disabled={isAdministrador || !canEdit}
                        className="rounded border-border"
                      />
                      {module.permissions[codename]}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} size="sm">
        <ModalHeader title="Confirmar cambios" onClose={() => setConfirmOpen(false)} />
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-main">
            Se guardará el rol &ldquo;{ROLE_LABEL[selectedRole]}&rdquo; con {draft.size} permiso(s)
            seleccionado(s).
          </p>
          {selfLockoutWarning && (
            <p className="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">
              Vas a perder acceso a esta pantalla al guardar (le quitaste &ldquo;Ver roles&rdquo;
              a tu propio rol).
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-main border border-border rounded-lg hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {saving ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
