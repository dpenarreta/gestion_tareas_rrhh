"use client";

import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import { PRIORITY_LABEL, PRIORITY_STRIPE, type DeskNotePriority, type RecipientOption } from "./types";
import type { Role } from "@/generated/prisma/client";

const PRIORITIES: DeskNotePriority[] = ["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"];
const MAX_LENGTH = 500;

export default function NewNoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [priority, setPriority] = useState<DeskNotePriority>("INFORMACION");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/desk-notes/recipients")
      .then((r) => r.json())
      .then((list: RecipientOption[]) => setRecipients(list));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!recipientId) { setError("Elige a quién va dirigida la nota"); return; }
    if (!message.trim()) { setError("Escribe un mensaje"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/desk-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, priority, message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error al dejar la nota");
      else onCreated();
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-title">Nueva nota</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Para *</label>
            <select
              required
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Selecciona un colaborador…</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {ROLE_LABEL[r.role as Role]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Prioridad</label>
            <div className="grid grid-cols-2 gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${
                    priority === p ? "border-primary bg-primary-surface text-primary" : "border-border text-main hover:border-primary/40"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRIORITY_STRIPE[p] }} />
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Mensaje *</label>
            <textarea
              required
              rows={4}
              maxLength={MAX_LENGTH}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe tu nota…"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <p className="mt-1 text-[11px] text-disabled text-right">{message.length}/{MAX_LENGTH}</p>
          </div>

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-xl">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? "Dejando nota…" : "Dejar nota"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
