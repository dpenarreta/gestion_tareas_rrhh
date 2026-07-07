"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

type UserInfo = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

type Badge = {
  id: string;
  icon: string;
  name: string;
  description: string;
  earned: boolean;
};

type BadgeStats = {
  totalCompleted: number;
  totalComments: number;
  currentStreak: number;
  earnedCount: number;
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

type ManualInfo = { href: string; label: string; description: string };

function getManualForRole(role: Role): ManualInfo {
  if (role === "ADMINISTRADOR") {
    return {
      href: "/manuales/manual-administrador.pdf",
      label: "Manual de Administrador",
      description: "Gestión de usuarios, cierre mensual, informes con IA, Analytics y comunicados.",
    };
  }
  if (role === "JEFE_NACIONAL" || role === "COORDINADOR_NACIONAL") {
    return {
      href: "/manuales/manual-jefe-coordinador.pdf",
      label: "Manual de Jefe Nacional y Coordinador Nacional",
      description: "Dashboard, gestión de equipo, Analytics, Nova, reuniones y Mejora Continua.",
    };
  }
  return {
    href: "/manuales/manual-colaboradores.pdf",
    label: "Manual de Colaborador",
    description: "Registro de tareas, seguimientos planificados, Mi actividad y Mejora Continua.",
  };
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [badgeStats, setBadgeStats] = useState<BadgeStats | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: UserInfo) => {
        setUser(data);
        setNameInput(data.name);
        setEmailInput(data.email);
      });

    fetch("/api/profile/badges")
      .then((r) => r.json())
      .then(({ badges: b, stats }) => {
        setBadges(b);
        setBadgeStats(stats);
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

  async function handleThemeChange(next: "light" | "dark") {
    setTheme(next);
    if (!user) return;
    try {
      await fetch(`/api/users/${user.userId}/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next.toUpperCase() }),
      });
    } catch {
      // el cambio local ya se aplicó; se reintentará sincronizar en el próximo toggle
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
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-2xl border border-border p-6 flex items-center gap-5">
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${avatarGradient(user.name)} flex items-center justify-center shrink-0`}>
          <span className="text-2xl font-bold text-white">{initials(user.name)}</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-title truncate">{user.name}</h1>
          <span className="inline-block mt-1 text-xs font-semibold bg-primary-surface text-primary border border-primline px-2 py-0.5 rounded-full">
            {ROLE_LABEL[user.role]}
          </span>
          <p className="text-xs text-disabled mt-1.5">Miembro desde {formatDate(user.createdAt)}</p>
        </div>
      </div>

      {/* Personal info */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-title">Información personal</h2>
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover hover:bg-primary-surface px-3 py-1.5 rounded-lg transition-colors"
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
              <p className="mt-4 text-sm text-success bg-success/[.13] px-3 py-2 rounded-lg">
                {infoSuccess}
              </p>
            )}
          </>
        ) : (
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">
                Nombre completo
              </label>
              <input
                type="text"
                required
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="Tu nombre completo"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="tu@correo.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Rol</label>
              <div className="px-3 py-2 rounded-xl border border-border bg-background text-sm text-secondary select-none">
                {ROLE_LABEL[user.role]}
                <span className="ml-2 text-xs text-disabled">(no editable)</span>
              </div>
            </div>

            {infoError && (
              <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">
                {infoError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={infoLoading}
                className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {infoLoading ? "Guardando…" : "Guardar cambios"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Preferencias */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h2 className="font-semibold text-title mb-1">Preferencias</h2>
        <p className="text-xs text-disabled mb-5">Elige cómo se ve Nexo en este dispositivo</p>

        {mounted && (
          <div className="flex gap-2 w-fit rounded-xl border border-border p-1 bg-background">
            <button
              type="button"
              onClick={() => handleThemeChange("light")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                resolvedTheme === "light" ? "bg-primary text-white" : "text-secondary hover:text-title"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Claro
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("dark")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                resolvedTheme === "dark" ? "bg-primary text-white" : "text-secondary hover:text-title"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              Oscuro
            </button>
          </div>
        )}
      </div>

      {/* Recursos y Manuales */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h2 className="font-semibold text-title mb-1">Recursos y Manuales</h2>
        <p className="text-xs text-disabled mb-5">Manual de usuario en PDF según tu rol</p>

        <a
          href={getManualForRole(user.role).href}
          download
          className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary-surface transition-colors group"
        >
          <div className="w-10 h-10 rounded-xl bg-primary-surface group-hover:bg-primary/15 flex items-center justify-center shrink-0 transition-colors">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-title">{getManualForRole(user.role).label}</p>
            <p className="text-xs text-secondary mt-0.5">{getManualForRole(user.role).description}</p>
          </div>
          <svg className="w-4 h-4 text-disabled shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>
      </div>

      {/* Reconocimientos */}
      {badges.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border p-6">
          <h2 className="font-semibold text-title mb-1">Reconocimientos</h2>
          <p className="text-xs text-disabled mb-5">Insignias obtenidas automáticamente según tu actividad</p>

          {badgeStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatChip label="Tareas completadas" value={badgeStats.totalCompleted} />
              <StatChip label="Comentarios" value={badgeStats.totalComments} />
              <StatChip label="Racha actual" value={`${badgeStats.currentStreak} días`} />
              <StatChip label="Insignias" value={`${badgeStats.earnedCount} / 6`} />
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {badges.map((b) => (
              <div
                key={b.id}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  b.earned
                    ? "border-primary/30 bg-primary-surface"
                    : "border-border bg-background opacity-40 grayscale"
                }`}
              >
                <span className="text-3xl block mb-2">{b.icon}</span>
                <p className="text-sm font-semibold text-title">{b.name}</p>
                <p className="text-xs text-secondary mt-1">{b.description}</p>
                {b.earned && (
                  <span className="inline-block mt-2 text-xs font-medium text-primary bg-primary-surface px-2 py-0.5 rounded-full">
                    Obtenida ✓
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change password */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h2 className="font-semibold text-title mb-5">Cambiar contraseña</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">
              Contraseña actual
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">
                Nueva contraseña
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">
                Confirmar contraseña
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          {pwError && (
            <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">
              {pwError}
            </p>
          )}
          {pwSuccess && (
            <p className="text-sm text-success bg-success/[.13] px-3 py-2 rounded-lg">
              {pwSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={pwLoading}
            className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
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
      <p className="text-[11px] font-semibold text-disabled uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-sm font-medium text-title">{value}</p>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background border border-border rounded-xl p-3 text-center">
      <p className="text-lg font-bold text-primary">{value}</p>
      <p className="text-xs text-secondary mt-0.5">{label}</p>
    </div>
  );
}
