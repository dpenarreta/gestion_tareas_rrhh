"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Skeleton";
import { Paperclip, ListTodo, History, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  type DeskNote,
  type DeskNoteReply,
  PRIORITY_STRIPE,
  PRIORITY_LABEL,
  COLOR_LABEL,
  MAX_NOTE_REPLIES,
  fmtRelative,
  fmtAbsolute,
} from "./types";
import NoteToReminderModal from "./NoteToReminderModal";
import DeskHistoryModal from "./DeskHistoryModal";

type Props = {
  note: DeskNote;
  variant: "received" | "sent";
  onClose: () => void;
  onRead: () => void;
  onConvertedToReminder: (reminderId: string) => void;
  onReplied: () => void;
};

const MAX_REPLY_LENGTH = 500;

export default function NoteDetailModal({ note, variant, onClose, onRead, onConvertedToReminder, onReplied }: Props) {
  const [replies, setReplies] = useState<DeskNoteReply[] | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const markedRead = useRef(false);

  // §1: abrir la tarjeta es lo único que marca la nota como leída — sin botón, sin acción adicional.
  useEffect(() => {
    if (variant === "received" && !note.read && !markedRead.current) {
      markedRead.current = true;
      onRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`/api/desk-notes/${note.id}/replies`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setReplies)
      .catch(() => setReplies([]));
  }, [note.id]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/desk-notes/${note.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al enviar la respuesta");
      } else {
        setReplies((prev) => [...(prev ?? []), data]);
        setReplyText("");
        onReplied();
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSending(false);
    }
  }

  const atLimit = (replies?.length ?? 0) >= MAX_NOTE_REPLIES;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="h-[6px] w-full rounded-t-2xl" style={{ background: PRIORITY_STRIPE[note.priority] }} />

          <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-border">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-title truncate">
                {variant === "sent" ? `Para ${note.recipientName}` : `De ${note.senderName}`}
              </p>
              <p className="text-[11px] text-secondary" title={fmtAbsolute(note.createdAt)}>
                {PRIORITY_LABEL[note.priority]} · {COLOR_LABEL[note.color]} · {fmtRelative(note.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setShowHistory(true)} title="Ver historial" className="p-1.5 text-secondary hover:text-title hover:bg-surface2 rounded-lg transition-colors">
                <History className="w-4 h-4" strokeWidth={1.8} />
              </button>
              <button onClick={onClose} aria-label="Cerrar" className="p-1.5 text-secondary hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            <p className="text-sm text-title whitespace-pre-wrap break-words leading-relaxed">{note.message}</p>

            {note.hasAttachment && (
              <a
                href={`/api/desk-notes/${note.id}/attachment`}
                download
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover bg-primary-surface px-2.5 py-1.5 rounded-lg"
              >
                <Paperclip className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                {note.attachmentName}
              </a>
            )}

            {variant === "received" && (
              <Button
                variant="success"
                size="sm"
                onClick={() => setShowConvert(true)}
                disabled={Boolean(note.convertedToReminderId)}
              >
                <ListTodo className="w-3.5 h-3.5" strokeWidth={2} />
                {note.convertedToReminderId ? "Ya convertida en recordatorio" : "Convertir en Recordatorio"}
              </Button>
            )}

            {/* §4 Respuestas cortas — máximo 2, nunca un chat. */}
            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Respuestas</h3>
              {replies === null ? (
                <div className="flex items-center justify-center py-4">
                  <Spinner className="w-4 h-4 text-primary" />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {replies.map((r) => (
                    <div key={r.id} className="bg-background rounded-xl px-3 py-2">
                      <p className="text-[11px] font-medium text-title">{r.authorName} <span className="font-normal text-secondary">· {fmtRelative(r.createdAt)}</span></p>
                      <p className="text-sm text-main mt-0.5 whitespace-pre-wrap break-words">{r.message}</p>
                    </div>
                  ))}

                  {atLimit ? (
                    <p className="text-xs text-secondary bg-surface2 rounded-xl px-3 py-2.5 leading-relaxed">
                      Esta conversación alcanzó el límite permitido. Si necesitan continuar el seguimiento, pueden convertir la nota en un Recordatorio o en una Tarea.
                    </p>
                  ) : (
                    <form onSubmit={sendReply} className="flex items-end gap-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={2}
                        maxLength={MAX_REPLY_LENGTH}
                        placeholder="Responder…"
                        className="flex-1 px-3 py-2 text-sm text-title bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!replyText.trim() || sending}
                        title="Enviar"
                        aria-label="Enviar"
                        className="shrink-0"
                      >
                        <Send className="w-4 h-4" strokeWidth={2} />
                      </Button>
                    </form>
                  )}
                  {error && <p className="text-xs text-danger bg-danger/[.09] px-3 py-2 rounded-lg">{error}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showConvert && (
        <NoteToReminderModal
          note={note}
          onClose={() => setShowConvert(false)}
          onConverted={(reminderId) => {
            onConvertedToReminder(reminderId);
            setShowConvert(false);
          }}
        />
      )}
      {showHistory && <DeskHistoryModal entityType="NOTE" entityId={note.id} title={note.message.slice(0, 60)} onClose={() => setShowHistory(false)} />}
    </>
  );
}
