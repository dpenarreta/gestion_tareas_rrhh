"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Fase 6c de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-17):
// pantalla nueva — el email de recuperación de Django apunta acá con
// `?token=...` (ver backend/apps/authentication/emails.py). Sin
// auto-login tras el éxito: Django revoca todas las sesiones del
// usuario al confirmar el reset, así que corresponde volver a /login.
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo restablecer la contraseña");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center mb-7">
          <div
            className="w-11 h-11 rounded-[11px] flex items-center justify-center text-white font-bold text-lg mb-3"
            style={{ background: "var(--gradient-brand)" }}
          >
            N
          </div>
          <p className="text-secondary text-[13px]">Sistema de Gestión de Recursos Humanos</p>
        </div>

        <div className="bg-surface rounded-2xl border border-border p-[30px]" style={{ boxShadow: "var(--shadow2)" }}>
          <h2 className="text-lg font-semibold text-title mb-2">Restablecer contraseña</h2>

          {!token ? (
            <>
              <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg mb-4">
                Enlace inválido — solicitá uno nuevo desde la pantalla de inicio de sesión.
              </p>
              <Link href="/login" className="block text-center text-sm text-primary hover:text-primary-hover">
                ← Volver al inicio de sesión
              </Link>
            </>
          ) : success ? (
            <>
              <div className="bg-primary-surface border border-primline rounded-[10px] p-4 text-sm text-primary mb-4">
                Tu contraseña fue actualizada. Iniciá sesión con tu nueva contraseña.
              </div>
              <Link
                href="/login"
                className="block w-full text-center py-2.5 px-4 bg-primary hover:brightness-110 text-white font-semibold rounded-[9px] text-sm transition-all"
              >
                Ir a iniciar sesión
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-secondary mb-6">Ingresá tu nueva contraseña.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-main mb-1">Nueva contraseña</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-[10px] border border-border2 bg-surface2 text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-surface text-sm transition-colors"
                    placeholder="••••••"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-main mb-1">Confirmar contraseña</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-[10px] border border-border2 bg-surface2 text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-surface text-sm transition-colors"
                    placeholder="••••••"
                  />
                </div>

                {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-primary hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-[9px] text-sm transition-all"
                >
                  {loading ? "Guardando..." : "Restablecer contraseña"}
                </button>
              </form>

              <Link href="/login" className="mt-4 block text-center text-sm text-secondary hover:text-title">
                ← Volver al inicio de sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
