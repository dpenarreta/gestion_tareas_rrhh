"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ROLE_LABEL } from "@/lib/roles";
import {
  PRIORITY_LABEL,
  PRIORITY_STRIPE,
  COLOR_LABEL,
  COLOR_SWATCH,
  type DeskNotePriority,
  type DeskNoteColor,
  type RecipientOption,
} from "./types";
import type { Role } from "@/generated/prisma/client";

const PRIORITIES: DeskNotePriority[] = ["INFORMACION", "RECORDATORIO", "IMPORTANTE", "URGENTE"];
const COLORS: DeskNoteColor[] = ["AMARILLO", "ROSADO", "CELESTE", "VERDE", "NARANJA", "LILA"];
const MAX_LENGTH = 500;

export default function NewNoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [priority, setPriority] = useState<DeskNotePriority>("INFORMACION");
  const [color, setColor] = useState<DeskNoteColor>("AMARILLO");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const formData = new FormData();
      formData.set("recipientId", recipientId);
      formData.set("priority", priority);
      formData.set("color", color);
      formData.set("message", message.trim());
      if (file) formData.set("file", file);

      const res = await fetch("/api/desk-notes", { method: "POST", body: formData });
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
            <label className="block text-xs font-semibold text-main mb-1.5">Color del Post-it</label>
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={COLOR_LABEL[c]}
                  aria-label={COLOR_LABEL[c]}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c ? "border-primary scale-110" : "border-transparent hover:scale-105"
                  }`}
                  style={{ background: COLOR_SWATCH[c] }}
                />
              ))}
            </div>
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

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Adjunto (opcional)</label>
            {file ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-background border border-border rounded-xl">
                <span className="flex items-center gap-1.5 text-xs text-title truncate">
                  <Paperclip className="w-3.5 h-3.5 shrink-0 text-secondary" strokeWidth={2} />
                  {file.name}
                </span>
                <button type="button" onClick={() => setFile(null)} className="text-disabled hover:text-danger shrink-0">
                  <XIcon className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
              >
                <Paperclip className="w-3.5 h-3.5" strokeWidth={2} />
                Adjuntar archivo (máx. 8MB)
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-xl">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">
              {saving ? "Dejando nota…" : "Dejar nota"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
