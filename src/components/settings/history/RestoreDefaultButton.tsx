"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { SettingDescriptor } from "@/components/settings/registry";

/**
 * Restaura una sección a sus valores por defecto — solo se renderiza (desde
 * ConfigSectionCard) cuando el descriptor tiene configKeys + defaults. Tras
 * confirmar y ejecutar, recarga la página: es la forma más simple y confiable
 * de reflejar el valor restaurado en las ~21 secciones existentes sin exigirles
 * un mecanismo de recarga externo.
 */
export default function RestoreDefaultButton({ descriptor }: { descriptor: SettingDescriptor }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const defaults = descriptor.defaults;

  if (!defaults || descriptor.configKeys.length === 0) return null;

  async function handleRestore() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/config-history/restore-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al restaurar los valores predeterminados", "error");
        setLoading(false);
        setShowConfirm(false);
        return;
      }
      showToast("Valores restaurados. Recargando…", "success");
      window.location.reload();
    } catch {
      showToast("Error de conexión", "error");
      setLoading(false);
      setShowConfirm(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        className="text-[11px] text-secondary hover:text-danger px-2 py-1 rounded hover:bg-danger/[.09] transition-colors disabled:opacity-50"
      >
        {loading ? "Restaurando…" : "Restaurar predeterminado"}
      </button>

      <ConfirmDialog
        open={showConfirm}
        title="Restaurar valores predeterminados"
        message={`¿Restaurar "${descriptor.label}" a sus valores predeterminados? Esta acción queda registrada en el historial.`}
        confirmLabel="Restaurar"
        loading={loading}
        onConfirm={handleRestore}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
