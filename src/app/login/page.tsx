"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rejectedNotice =
    searchParams.get("consentRejected") === "1"
      ? "Has rechazado el tratamiento de datos. No puedes acceder al sistema."
      : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotMsg, setForgotMsg] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al iniciar sesión");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setForgotMsg(data.message);
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
          <p className="text-secondary text-[13px]">
            Sistema de Gestión de Recursos Humanos
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-border p-[30px]" style={{ boxShadow: "var(--shadow2)" }}>
          {!forgotMode ? (
            <>
              <h2 className="text-[22px] font-bold text-title mb-6">
                Bienvenido a Nexo
              </h2>
              {rejectedNotice && (
                <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg mb-4">
                  {rejectedNotice}
                </p>
              )}
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-main mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-[10px] border border-border2 bg-surface2 text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-surface text-sm transition-colors"
                    placeholder="usuario@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-main mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-[10px] border border-border2 bg-surface2 text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-surface text-sm transition-colors"
                    placeholder="••••••"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary accent-primary"
                  />
                  <span className="text-sm text-main">Recordarme por 30 días</span>
                </label>

                {error && (
                  <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-primary hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-[9px] text-sm transition-all"
                >
                  {loading ? "Ingresando..." : "Ingresar"}
                </button>
              </form>

              <button
                onClick={() => {
                  setForgotMode(true);
                  setError("");
                  setForgotMsg("");
                }}
                className="mt-4 w-full text-center text-sm text-primary hover:text-primary-hover"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-title mb-2">
                Recuperar contraseña
              </h2>
              <p className="text-sm text-secondary mb-6">
                Ingresa tu correo y te indicaremos a dónde se enviaría el
                enlace de recuperación.
              </p>

              {forgotMsg ? (
                <div className="bg-primary-surface border border-primline rounded-[10px] p-4 text-sm text-primary">
                  {forgotMsg}
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-main mb-1">
                      Correo electrónico
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 rounded-[10px] border border-border2 bg-surface2 text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-surface text-sm transition-colors"
                      placeholder="usuario@empresa.com"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-lg">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-primary hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-[9px] text-sm transition-all"
                  >
                    {loading ? "Enviando..." : "Recuperar contraseña"}
                  </button>
                </form>
              )}

              <button
                onClick={() => {
                  setForgotMode(false);
                  setForgotMsg("");
                  setError("");
                }}
                className="mt-4 w-full text-center text-sm text-secondary hover:text-title"
              >
                ← Volver al inicio de sesión
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
