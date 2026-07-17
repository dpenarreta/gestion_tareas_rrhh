"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";

export default function WelcomeMessageSection() {
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/welcome-message");
      if (res.ok) {
        const data = await res.json();
        setMessage(data.message);
        setActive(data.active);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  async function handleSave() {
    setMsg(null);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/welcome-message", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, active }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al guardar el mensaje de bienvenida");
      } else {
        setMessage(data.message);
        setActive(data.active);
        setMsg("Mensaje de bienvenida actualizado.");
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Mensaje de bienvenida">
      {loading ? (
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {msg && (
            <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
              <span>{msg}</span>
              <button onClick={() => setMsg(null)} className="ml-2 text-success hover:brightness-90 font-bold">×</button>
            </div>
          )}
          {error && (
            <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
            </div>
          )}
          <p className="text-xs text-secondary">
            Si está activo y no está vacío, aparece como una tarjeta destacada en el Dashboard de todos los usuarios.
          </p>

          <label className="flex items-center gap-2 text-sm font-medium text-title cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            Mostrar mensaje en el Dashboard
          </label>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Escribe el mensaje de bienvenida…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Guardando…" : "Guardar mensaje"}
          </button>
        </>
      )}
    </SectionCard>
  );
}
