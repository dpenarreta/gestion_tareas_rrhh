"use client";

import { useState, useEffect, useCallback } from "react";
import { ROLE_LABEL, ALL_ROLES, ROLE_LEVEL } from "@/lib/roles";
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

function formatConsentDate(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  currentUserRole: Role;
};

export default function UsersManager({ currentUserRole }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create form
  const [form, setForm] = useState({ name: "", email: "", role: "" as Role | "" });
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [informedConsent, setInformedConsent] = useState(false);

  // Edit modal
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "" as Role });
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  // Revealed (unmasked) emails, keyed by user id
  const [revealedEmails, setRevealedEmails] = useState<Record<string, string>>({});
  const [revealLoading, setRevealLoading] = useState<string | null>(null);

  // Roles that the current editor is allowed to assign
  const assignableRoles = ALL_ROLES.filter(
    (r) => ROLE_LEVEL[r] <= ROLE_LEVEL[currentUserRole]
  );

  function canEdit(user: User): boolean {
    // Solo un Administrador puede editar a otro Administrador
    if (user.role === "ADMINISTRADOR" && currentUserRole !== "ADMINISTRADOR") return false;
    // COORDINADOR_NACIONAL no puede editar a JEFE_NACIONAL
    if (user.role === "JEFE_NACIONAL" && currentUserRole !== "JEFE_NACIONAL" && currentUserRole !== "ADMINISTRADOR") return false;
    return true;
  }

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

  useEffect(() => {
    queueMicrotask(loadUsers);
  }, [loadUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.role) {
      setFormError("Selecciona un rol");
      return;
    }
    if (!informedConsent) {
      setFormError("Debes confirmar que el usuario fue informado sobre el tratamiento de sus datos");
      return;
    }
    setFormLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Error al crear usuario");
      } else {
        setShowCreate(false);
        setForm({ name: "", email: "", role: "" });
        setInformedConsent(false);
        loadUsers();
      }
    } catch {
      setFormError("Error de conexión");
    } finally {
      setFormLoading(false);
    }
  }

  async function openEdit(user: User) {
    setEditUser(user);
    setEditForm({ name: user.name, email: user.email, role: user.role });
    setEditError("");
    setEditSuccess(false);
    try {
      const res = await fetch(`/api/users/${user.id}`);
      if (res.ok) {
        const full = await res.json();
        setEditForm((f) => ({ ...f, email: full.email }));
      }
    } catch {
      // el correo enmascarado ya está precargado; el usuario puede reintentar guardando de nuevo
    }
  }

  async function handleReveal(user: User) {
    if (revealedEmails[user.id]) {
      setRevealedEmails((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      return;
    }
    if (!confirm(`¿Mostrar el correo completo de ${user.name}?`)) return;
    setRevealLoading(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`);
      const data = await res.json();
      if (res.ok) {
        setRevealedEmails((prev) => ({ ...prev, [user.id]: data.email }));
      }
    } finally {
      setRevealLoading(null);
    }
  }

  function closeEdit() {
    setEditUser(null);
    setEditError("");
    setEditSuccess(false);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditError("");
    setEditSuccess(false);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error ?? "Error al guardar cambios");
      } else {
        setEditSuccess(true);
        setEditUser(data);
        loadUsers();
      }
    } catch {
      setEditError("Error de conexión");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleReset(user: User) {
    setResetMsg(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Error al resetear");
      } else {
        setResetMsg(data.message);
      }
    } catch {
      setActionError("Error de conexión");
    }
  }

  async function handleResetConsent(user: User) {
    if (
      !confirm(
        `¿Deseas que ${user.name} vea nuevamente el aviso de protección de datos en su próximo login?`
      )
    )
      return;
    setResetMsg(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-consent`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Error al restablecer el consentimiento");
      } else {
        setResetMsg(`Se restableció el aviso de protección de datos para ${user.name}.`);
        loadUsers();
      }
    } catch {
      setActionError("Error de conexión");
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
    setResetMsg(null);
    setActionError(null);
    try {
      const res = await fetch("/api/users/reset-consent-all", { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Error al restablecer el consentimiento");
      } else {
        setResetMsg(`Se restableció el consentimiento de ${data.count} usuario(s).`);
        loadUsers();
      }
    } catch {
      setActionError("Error de conexión");
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`¿Eliminar a ${user.name}? Esta acción no se puede deshacer.`))
      return;
    setActionError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Error al eliminar");
      } else {
        loadUsers();
      }
    } catch {
      setActionError("Error de conexión");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-main">
          {users.length} usuario{users.length !== 1 ? "s" : ""} registrado
          {users.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          {currentUserRole === "ADMINISTRADOR" && (
            <button
              onClick={handleResetConsentAll}
              className="px-4 py-2 border border-border hover:bg-black/5 dark:hover:bg-white/5 text-main font-medium rounded-lg text-sm transition-colors"
              title="Restablecer el aviso de protección de datos para todos los usuarios"
            >
              🔄 Restablecer consentimiento de todos
            </button>
          )}
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setFormError("");
              setInformedConsent(false);
            }}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg text-sm transition-colors"
          >
            {showCreate ? "Cancelar" : "+ Nuevo usuario"}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="font-semibold text-title mb-4">Crear usuario</h3>
          <p className="text-xs text-secondary mb-4">
            La contraseña por defecto será: <strong>123456</strong>
          </p>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-main mb-1">
                  Nombre completo
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border text-title focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-main mb-1">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border text-title focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-main mb-1">
                Rol
              </label>
              <select
                required
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as Role })
                }
                className="w-full px-3 py-2 rounded-lg border border-border text-title focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-surface"
              >
                <option value="">Seleccionar rol...</option>
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={informedConsent}
                onChange={(e) => setInformedConsent(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-border text-primary accent-primary"
              />
              <span className="text-sm text-main">
                El usuario ha sido informado sobre el tratamiento de sus datos personales
              </span>
            </label>

            {formError && (
              <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={formLoading || !informedConsent}
              className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {formLoading ? "Creando..." : "Crear usuario"}
            </button>
          </form>
        </div>
      )}

      {resetMsg && (
        <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
          <span>{resetMsg}</span>
          <button
            onClick={() => setResetMsg(null)}
            className="ml-2 text-success hover:brightness-90 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {actionError && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="ml-2 text-danger hover:brightness-90 font-bold"
          >
            ×
          </button>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-secondary text-sm">
            No hay usuarios registrados
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="text-left px-5 py-3 font-medium text-main">
                  Nombre
                </th>
                <th className="text-left px-5 py-3 font-medium text-main hidden sm:table-cell">
                  Correo
                </th>
                <th className="text-left px-5 py-3 font-medium text-main">
                  Rol
                </th>
                <th className="text-left px-5 py-3 font-medium text-main hidden md:table-cell">
                  Consentimiento
                </th>
                <th className="text-right px-5 py-3 font-medium text-main">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                  <td className="px-5 py-3 font-medium text-title">
                    {user.name}
                  </td>
                  <td className="px-5 py-3 text-main hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <span>{revealedEmails[user.id] ?? user.email}</span>
                      <button
                        onClick={() => handleReveal(user)}
                        disabled={revealLoading === user.id}
                        className="text-xs text-primary hover:text-primary-hover font-medium disabled:opacity-50"
                      >
                        {revealLoading === user.id
                          ? "..."
                          : revealedEmails[user.id]
                          ? "Ocultar"
                          : "Ver"}
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="px-2.5 py-1 bg-primary-surface text-primary rounded-full text-xs font-medium">
                      {ROLE_LABEL[user.role]}
                    </span>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    {user.dataConsentAccepted ? (
                      <span className="px-2.5 py-1 bg-success/[.13] text-success rounded-full text-xs font-medium">
                        Aceptado
                        {user.dataConsentAcceptedAt && ` · ${formatConsentDate(user.dataConsentAcceptedAt)}`}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-surface2 text-secondary rounded-full text-xs font-medium">
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {canEdit(user) && (
                        <button
                          onClick={() => openEdit(user)}
                          className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors"
                        >
                          Editar
                        </button>
                      )}
                      <button
                        onClick={() => handleReset(user)}
                        className="text-xs text-warning hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-warning/[.15] transition-colors"
                        title="Resetear contraseña a 123456"
                      >
                        Resetear pwd
                      </button>
                      <button
                        onClick={() => handleResetConsent(user)}
                        className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors"
                        title="Restablecer aviso de protección de datos"
                      >
                        🔄 Consentimiento
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        className="text-xs text-danger hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-danger/[.09] transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {editUser && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={closeEdit}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-base font-semibold text-title">Editar usuario</h2>
                <button
                  onClick={closeEdit}
                  className="p-1.5 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleEdit} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-main mb-1">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border text-title focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-main mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    required
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border text-title focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-main mb-1">
                    Rol
                  </label>
                  <select
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
                    className="w-full px-3 py-2 rounded-lg border border-border text-title focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-surface"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  {currentUserRole !== "JEFE_NACIONAL" && (
                    <p className="mt-1 text-[11px] text-disabled">
                      Solo el Jefe Nacional puede asignar ese rol.
                    </p>
                  )}
                </div>

                {editError && (
                  <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">
                    {editError}
                  </p>
                )}

                {editSuccess && (
                  <p className="text-sm text-success bg-success/[.13] px-3 py-2 rounded-lg flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Cambios guardados exitosamente
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={closeEdit}
                    className="px-4 py-2 text-sm font-medium text-main border border-border rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    disabled={editLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
                  >
                    {editLoading ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
