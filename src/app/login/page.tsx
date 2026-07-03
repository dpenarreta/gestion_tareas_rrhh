"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
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
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary tracking-tight">
            Nexo
          </h1>
          <p className="mt-1 text-secondary text-sm">
            Sistema de Gestión de Recursos Humanos
          </p>
        </div>

        <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
          {!forgotMode ? (
            <>
              <h2 className="text-lg font-semibold text-title mb-6">
                Iniciar sesión
              </h2>
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
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-title placeholder-disabled focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
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
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-title placeholder-disabled focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
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
                  <p className="text-sm text-danger bg-danger/10 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
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
                <div className="bg-primary-surface border border-primary/20 rounded-lg p-4 text-sm text-primary">
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
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-title placeholder-disabled focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
                      placeholder="usuario@empresa.com"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-danger bg-danger/10 px-3 py-2 rounded-lg">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
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
