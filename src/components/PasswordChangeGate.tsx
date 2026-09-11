"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Bloquea la aplicación mientras la cuenta tenga pendiente un cambio de
 * contraseña obligatorio, y ofrece cambiarla ahí mismo.
 *
 * Existe porque ese estado ya bloqueaba todo del lado de Django sin que el
 * frontend lo supiera. `apps/authentication/authentication.py` responde
 * **403 `password_change_required`** a toda petición salvo cuatro rutas
 * mientras `must_change_password` esté activo, así que quien recibía un
 * restablecimiento entraba, veía el menú, y todas las pantallas aparecían
 * vacías sin explicación — sin forma de salir, porque tampoco podía llegar
 * a Ajustes. Pasó en producción el 2026-09-11 (ver docs/AUDIT_LOG.md).
 *
 * Mismo patrón que `ConsentGate`: mientras no se resuelva, no se renderiza
 * el resto de la aplicación, para que no se disparen llamadas que igual
 * responderían 403.
 */
export default function PasswordChangeGate({
  mustChange,
  onLogout,
  children,
}: {
  mustChange: boolean;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [pendiente, setPendiente] = useState(mustChange);

  if (!pendiente) return <>{children}</>;

  return <PasswordChangeModal onDone={() => setPendiente(false)} onLogout={onLogout} />;
}

function PasswordChangeModal({
  onDone,
  onLogout,
}: {
  onDone: () => void;
  onLogout: () => Promise<void>;
}) {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (nueva !== confirmacion) {
      setError("La nueva contraseña y su confirmación no coinciden.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: actual, newPassword: nueva }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "No se pudo cambiar la contraseña.");
        return;
      }
      onDone();
      // Django limpia `must_change_password` al cambiarla, pero el layout ya
      // se renderizó con el valor anterior: `refresh()` vuelve a pedirlo
      // para que el resto de la aplicación arranque con datos frescos.
      router.refresh();
    } catch {
      setError("Error de conexión. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-title">Definí una contraseña nueva</h2>
        <p className="mt-2 text-sm text-secondary">
          Tu contraseña fue restablecida, así que hay que cambiarla antes de seguir. Hasta
          entonces el sistema no te va a dejar entrar a ninguna sección.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="actual" className="mb-1.5 block text-xs font-semibold text-main">
              Contraseña actual
            </label>
            <input
              id="actual"
              type="password"
              required
              autoComplete="current-password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-title focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-[11px] text-disabled">
              Es la que usaste para entrar recién.
            </p>
          </div>

          <div>
            <label htmlFor="nueva" className="mb-1.5 block text-xs font-semibold text-main">
              Contraseña nueva
            </label>
            <input
              id="nueva"
              type="password"
              required
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-title focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="confirmacion" className="mb-1.5 block text-xs font-semibold text-main">
              Repetí la contraseña nueva
            </label>
            <input
              id="confirmacion"
              type="password"
              required
              autoComplete="new-password"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-title focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Guardando…" : "Cambiar contraseña"}
          </Button>
        </form>

        {/* Cerrar sesión es la única salida legítima si no se recuerda la
            contraseña actual: sin esto, quien no la sepa queda encerrado en
            este modal sin poder siquiera volver al login. Usa la misma
            Server Action que el resto de la aplicación. */}
        <form action={onLogout} className="mt-3">
          <button type="submit" className="w-full text-xs text-disabled hover:text-main">
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
