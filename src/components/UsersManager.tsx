"use client";

import { useState, useEffect, useCallback } from "react";
import { ROLE_LABEL, ALL_ROLES, ROLE_LEVEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";

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
  const { showToast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

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
        showToast("Usuario creado.", "success");
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
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditError("");
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
        setEditUser(data);
        showToast("Cambios guardados correctamente.", "success");
        loadUsers();
      }
    } catch {
      setEditError("Error de conexión");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`¿Eliminar a ${user.name}? Esta acción no se puede deshacer.`))
      return;
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al eliminar", "error");
      } else {
        showToast("Usuario eliminado.", "success");
        loadUsers();
      }
    } catch {
      showToast("Error de conexión", "error");
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
          <Button
            onClick={() => {
              setShowCreate(!showCreate);
              setFormError("");
              setInformedConsent(false);
            }}
          >
            {showCreate ? "Cancelar" : "+ Nuevo usuario"}
          </Button>
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
                {assignableRoles.map((r) => (
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

            <Button type="submit" disabled={formLoading || !informedConsent}>
              {formLoading ? "Creando..." : "Crear usuario"}
            </Button>
          </form>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHead>
            <TableRow>
              <Th>Nombre</Th>
              <Th className="hidden sm:table-cell">Correo</Th>
              <Th>Rol</Th>
              <Th className="hidden md:table-cell">Consentimiento</Th>
              <Th className="text-right">Acciones</Th>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <Td colSpan={5} className="p-0">
                      <SkeletonRow columns={5} />
                    </Td>
                  </TableRow>
                ))}
              </>
            )}
            {!loading && users.length === 0 && (
              <TableRow>
                <Td colSpan={5} className="p-0">
                  <EmptyState title="No hay usuarios registrados" />
                </Td>
              </TableRow>
            )}
            {!loading && users.map((user) => (
                <TableRow key={user.id}>
                  <Td className="font-medium text-title">
                    {user.name}
                  </Td>
                  <Td className="hidden sm:table-cell">
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
                  </Td>
                  <Td>
                    <span className="px-2.5 py-1 bg-primary-surface text-primary rounded-full text-xs font-medium">
                      {ROLE_LABEL[user.role]}
                    </span>
                  </Td>
                  <Td className="hidden md:table-cell">
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
                  </Td>
                  <Td>
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
                        onClick={() => handleDelete(user)}
                        className="text-xs text-danger hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-danger/[.09] transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  </Td>
                </TableRow>
              ))}
          </TableBody>
        </Table>
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

                <div className="flex items-center justify-end gap-3 pt-1">
                  <Button type="button" variant="secondary" onClick={closeEdit}>
                    Cerrar
                  </Button>
                  <Button type="submit" disabled={editLoading}>
                    {editLoading ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
