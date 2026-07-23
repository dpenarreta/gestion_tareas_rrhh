"use client";

import { useEffect, useState } from "react";
import { Search, MessageCircle } from "lucide-react";
import {
  PRIORITY_LABEL,
  PRIORITY_STRIPE,
  REMINDER_PRIORITY_LABEL,
  REMINDER_PRIORITY_COLOR,
  fmtRelative,
  fmtDueDateTime,
  type DeskNotePriority,
} from "./types";

type NoteResult = {
  id: string;
  message: string;
  priority: DeskNotePriority;
  read: boolean;
  archived: boolean;
  createdAt: string;
  senderName: string;
  recipientName: string;
  isMine: boolean;
  replyCount: number;
};

type ReminderResult = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  priority: "BAJA" | "MEDIA" | "ALTA" | "URGENTE";
  status: "PENDIENTE" | "COMPLETADO";
};

const STATUS_OPTIONS = [
  { value: "", label: "Cualquier estado" },
  { value: "PENDIENTE", label: "Nota pendiente" },
  { value: "LEIDA", label: "Nota leída" },
  { value: "ARCHIVADA", label: "Nota archivada" },
  { value: "COMPLETADO", label: "Recordatorio completado" },
];

/**
 * §9 del refinamiento — un único buscador inteligente, accesible desde
 * cualquier pestaña sin tener que cambiar de sección (por eso vive como
 * overlay en DeskBoard, no como pestaña propia). Localiza simultáneamente
 * notas pendientes/archivadas, recordatorios activos/completados y
 * comentarios (respuestas de notas) en una sola consulta.
 */
export default function GlobalSearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [date, setDate] = useState("");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<{ notes: NoteResult[]; reminders: ReminderResult[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (priority) params.set("priority", priority);
      if (date) params.set("date", date);
      if (sender) params.set("sender", sender);
      if (recipient) params.set("recipient", recipient);
      if (status) params.set("status", status);
      const res = await fetch(`/api/desk/search?${params.toString()}`);
      setResults(res.ok ? await res.json() : { notes: [], reminders: [] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[8vh] px-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-surface border border-border rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="text-base font-semibold text-title">Buscar en Escritorio Digital</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={runSearch} className="p-6 space-y-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-disabled" strokeWidth={2} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por texto en notas, respuestas o recordatorios…"
              className="w-full pl-9 pr-3 py-2 text-sm text-title bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="px-2.5 py-1.5 text-xs text-title bg-background border border-border rounded-lg">
              <option value="">Cualquier prioridad</option>
              {(["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"] as DeskNotePriority[]).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2.5 py-1.5 text-xs text-title bg-background border border-border rounded-lg" />
            <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Remitente" className="px-2.5 py-1.5 text-xs text-title bg-background border border-border rounded-lg" />
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Destinatario" className="px-2.5 py-1.5 text-xs text-title bg-background border border-border rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="flex-1 px-2.5 py-1.5 text-xs text-title bg-background border border-border rounded-lg">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button type="submit" disabled={loading} className="px-4 py-1.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-medium rounded-lg">
              {loading ? "Buscando…" : "Buscar"}
            </button>
          </div>
        </form>

        <div className="p-6">
          {results === null ? (
            <p className="text-xs text-disabled text-center py-6">Escribe un término o ajusta los filtros para buscar.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Notas ({results.notes.length})</h4>
                {results.notes.length === 0 ? (
                  <p className="text-xs text-disabled">Sin resultados</p>
                ) : (
                  <ul className="space-y-1.5">
                    {results.notes.map((n) => (
                      <li key={n.id} className="bg-background border border-border rounded-xl p-2.5 text-xs">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_STRIPE[n.priority] }} />
                          <span className="font-medium text-title">{n.isMine ? `Para ${n.recipientName}` : `De ${n.senderName}`}</span>
                          <span className="text-disabled">· {fmtRelative(n.createdAt)}</span>
                          {n.archived && <span className="text-disabled">· Archivada</span>}
                          {n.replyCount > 0 && (
                            <span className="flex items-center gap-0.5 text-disabled">
                              <MessageCircle className="w-2.5 h-2.5" strokeWidth={2} /> {n.replyCount}
                            </span>
                          )}
                        </div>
                        <p className="text-main truncate">{n.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Recordatorios ({results.reminders.length})</h4>
                {results.reminders.length === 0 ? (
                  <p className="text-xs text-disabled">Sin resultados</p>
                ) : (
                  <ul className="space-y-1.5">
                    {results.reminders.map((r) => (
                      <li key={r.id} className="bg-background border border-border rounded-xl p-2.5 text-xs">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: REMINDER_PRIORITY_COLOR[r.priority] }} />
                          <span className="font-medium text-title">{r.title}</span>
                          <span className="text-disabled">· {REMINDER_PRIORITY_LABEL[r.priority]}</span>
                        </div>
                        <p className="text-secondary">{fmtDueDateTime(r.dueAt)} {r.status === "COMPLETADO" ? "· Completado" : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
