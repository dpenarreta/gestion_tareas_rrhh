"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

export default function WelcomeMessageSection() {
  const { showToast } = useToast();
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      const res = await fetch("/api/settings/welcome-message", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, active }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar el mensaje de bienvenida", "error");
      } else {
        setMessage(data.message);
        setActive(data.active);
        showToast("Mensaje de bienvenida actualizado.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Mensaje de bienvenida">
      {loading ? (
        <div className="flex justify-center items-center py-8">
          <Spinner className="w-5 h-5" />
        </div>
      ) : (
        <>
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

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar mensaje"}
          </Button>
        </>
      )}
    </SectionCard>
  );
}
