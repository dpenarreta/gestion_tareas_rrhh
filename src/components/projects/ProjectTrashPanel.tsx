"use client";

import { useEffect, useState } from "react";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "./types";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type TrashedProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  responsible: { id: string; name: string };
  createdBy: { id: string; name: string };
  deletedAt: string;
  expiresAt: string | null;
  msRemaining: number;
  /** Sprint 2.1 §3: solo el creador puede restaurar/eliminar — liderazgo puede ver la papelera completa sin poder actuar sobre lo que no creó. */
  canDelete: boolean;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Vencido — pendiente de purga";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `Vence en ${days}d ${restHours}h`;
  }
  return `Vence en ${hours}h ${minutes}min`;
}

type Props = {
  onClose: () => void;
  /** Se llama tras restaurar exitosamente, para que la lista de proyectos (montada aparte) se resincronice. */
  onRestored?: () => void;
};

export default function ProjectTrashPanel({ onClose, onRestored }: Props) {
  const { showToast } = useToast();
  const [items, setItems] = useState<TrashedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; name: string; type: "restore" | "delete" } | null>(null);

  useEffect(() => {
    fetch("/api/projects/trash")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  async function restoreItem(id: string, name: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${id}/restore`, { method: "POST" });
      if (res.ok) {
        setItems((prev) => prev.filter((p) => p.id !== id));
        onRestored?.();
        showToast("Proyecto restaurado.", "success");
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error ?? "No se pudo restaurar el proyecto.", "error", {
          label: "Reintentar",
          onClick: () => restoreItem(id, name),
        });
      }
    } catch {
      showToast("Error de conexión.", "error", { label: "Reintentar", onClick: () => restoreItem(id, name) });
    } finally {
      setBusyId(null);
      setPendingAction(null);
    }
  }

  async function deleteForever(id: string, name: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${id}/permanent`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((p) => p.id !== id));
        showToast("Proyecto eliminado definitivamente.", "success");
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error ?? "No se pudo eliminar el proyecto.", "error", {
          label: "Reintentar",
          onClick: () => deleteForever(id, name),
        });
      }
    } catch {
      showToast("Error de conexión.", "error", { label: "Reintentar", onClick: () => deleteForever(id, name) });
    } finally {
      setBusyId(null);
      setPendingAction(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-full max-w-md bg-surface border-l border-border shadow-xl z-50 flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-title text-sm">Papelera</h3>
            <p className="text-xs text-secondary">Proyectos eliminados, pendientes de purga automática</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <div className="text-center text-disabled text-sm py-8">Cargando…</div>}
          {!loading && items.length === 0 && (
            <div className="text-center text-disabled text-sm py-12">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              La papelera está vacía
            </div>
          )}
          {items.map((p) => (
            <div key={p.id} className="bg-background border border-border rounded-2xl p-3.5">
              <p className="text-sm font-medium text-title">{p.name}</p>
              <p className="text-xs text-secondary mt-0.5">
                {PROJECT_STATUS_LABEL[p.status]} · Responsable: {p.responsible.name}
              </p>
              <p className="text-[11px] text-warning mt-1">{formatRemaining(p.msRemaining)}</p>
              {p.canDelete ? (
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => setPendingAction({ id: p.id, name: p.name, type: "restore" })}
                    disabled={busyId === p.id}
                    className="flex-1 bg-primary text-white rounded-lg py-1.5 text-xs font-medium hover:bg-primary-hover disabled:opacity-40"
                  >
                    Restaurar
                  </button>
                  <button
                    onClick={() => setPendingAction({ id: p.id, name: p.name, type: "delete" })}
                    disabled={busyId === p.id}
                    className="flex-1 border border-danger text-danger rounded-lg py-1.5 text-xs font-medium hover:bg-danger/[.08] disabled:opacity-40"
                  >
                    Eliminar definitivamente
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-disabled mt-2">
                  Solo {p.createdBy.name} (creador) puede restaurar o eliminar definitivamente.
                </p>
              )}
            </div>
          ))}
        </div>
      </aside>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.type === "delete" ? "Eliminar definitivamente" : "Restaurar proyecto"}
        message={
          pendingAction?.type === "delete"
            ? `¿Eliminar "${pendingAction.name}" definitivamente? Esta acción no se puede deshacer.`
            : `¿Restaurar "${pendingAction?.name}"?`
        }
        danger={pendingAction?.type === "delete"}
        loading={busyId === pendingAction?.id}
        onConfirm={() => {
          if (!pendingAction) return;
          if (pendingAction.type === "delete") deleteForever(pendingAction.id, pendingAction.name);
          else restoreItem(pendingAction.id, pendingAction.name);
        }}
        onCancel={() => setPendingAction(null)}
      />
    </>
  );
}
