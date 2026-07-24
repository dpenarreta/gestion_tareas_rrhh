"use client";

import { useEffect, useState } from "react";
import type { ProjectHistoryEntry } from "./types";
import { HISTORY_EVENT_LABEL } from "./types";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

export default function ProjectHistoryTab({ projectId }: { projectId: string }) {
  const [history, setHistory] = useState<ProjectHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  function load() {
    setLoading(true);
    setError(false);
    fetch(`/api/projects/${projectId}/history`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      // Sprint C §7: antes un fallo de red mostraba el mismo "sin eventos" que
      // un proyecto genuinamente sin historial — indistinguibles para el usuario.
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { queueMicrotask(load); }, [projectId]);

  if (loading) return <div className="text-center text-disabled text-sm py-8">Cargando…</div>;
  if (error) {
    return (
      <div className="text-center text-sm py-12 bg-surface border border-border rounded-2xl space-y-2">
        <p className="text-danger">No se pudo cargar el historial.</p>
        <button onClick={load} className="text-primary font-medium hover:text-primary-hover">Reintentar</button>
      </div>
    );
  }
  if (history.length === 0) {
    return <div className="text-center text-disabled text-sm py-12 bg-surface border border-border rounded-2xl">Sin eventos registrados</div>;
  }

  return (
    <div className="max-w-2xl">
      <ol className="relative border-l border-border ml-2 space-y-4">
        {history.map((h) => (
          <li key={h.id} className="ml-4">
            <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-primary" />
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">{HISTORY_EVENT_LABEL[h.event]}</p>
            <p className="text-sm text-title">{h.description}</p>
            <p className="text-xs text-disabled">{h.actor.name} · {formatDateTime(h.createdAt)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
