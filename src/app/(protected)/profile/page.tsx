"use client";

import { useState, useEffect } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

type UserInfo = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

const AVATAR_COLORS = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-indigo-500",
  "from-violet-500 to-purple-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
];

function avatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserInfo | null>(null);

  // Personal info edit state
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [infoSuccess, setInfoSuccess] = useState("");

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: UserInfo) => {
        setUser(data);
        setNameInput(data.name);
        setEmailInput(data.email);
      });
  }, []);

  function startEdit() {
    if (!user) return;
    setNameInput(user.name);
    setEmailInput(user.email);
    setInfoError("");
    setInfoSuccess("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setInfoError("");
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setInfoError("");
    setInfoSuccess("");
    if (!nameInput.trim()) { setInfoError("El nombre no puede estar vacío"); return; }
    if (!emailInput.trim()) { setInfoError("El correo no puede estar vacío"); return; }

    setInfoLoading(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim(), email: emailInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInfoError(data.error ?? "Error al guardar");
      } else {
        setUser(data);
        setEditing(false);
        setInfoSuccess("Perfil actualizado correctamente");
      }
    } catch {
      setInfoError("Error de conexión");
    } finally {
      setInfoLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");

    if (newPassword !== confirmPassword) {
      setPwError("Las contraseñas nuevas no coinciden");
      return;
    }
    if (newPassword.length < 6) {
      setPwError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setPwLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error ?? "Error al cambiar contraseña");
      } else {
        setPwSuccess("Contraseña actualizada correctamente");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setPwError("Error de conexión");
    } finally {
      setPwLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center gap-5">
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${avatarGradient(user.name)} flex items-center justify-center shrink-0`}>
          <span className="text-2xl font-bold text-white">{initials(user.name)}</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 truncate">{user.name}</h1>
          <span className="inline-block mt-1 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full">
            {ROLE_LABEL[user.role]}
          </span>
          <p className="text-xs text-slate-400 mt-1.5">Miembro desde {formatDate(user.createdAt)}</p>
        </div>
      </div>

      {/* Personal info */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-slate-900">Información personal</h2>
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Editar
            </button>
          )}
        </div>

        {!editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ReadField label="Nombre completo" value={user.name} />
              <ReadField label="Correo electrónico" value={user.email} />
              <ReadField label="Rol" value={ROLE_LABEL[user.role]} />
            </div>
            {infoSuccess && (
              <p className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
                {infoSuccess}
              </p>
            )}
          </>
        ) : (
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nombre completo
              </label>
              <input
                type="text"
                required
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                placeholder="Tu nombre completo"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                placeholder="tu@correo.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Rol</label>
              <div className="px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 text-sm text-slate-500 select-none">
                {ROLE_LABEL[user.role]}
                <span className="ml-2 text-xs text-slate-400">(no editable)</span>
              </div>
            </div>

            {infoError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                {infoError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={infoLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {infoLoading ? "Guardando…" : "Guardar cambios"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Change password */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-5">Cambiar contraseña</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Contraseña actual
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nueva contraseña
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Confirmar contraseña
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              />
            </div>
          </div>

          {pwError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              {pwError}
            </p>
          )}
          {pwSuccess && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
              {pwSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={pwLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {pwLoading ? "Guardando…" : "Actualizar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
