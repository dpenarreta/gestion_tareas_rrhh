"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, CheckCheck, Pin, PinOff, Archive, ArchiveRestore, Trash2, Paperclip, ListTodo, MessageCircle } from "lucide-react";
import { type DeskNote, PRIORITY_STRIPE, COLOR_BG_CLASSES, MAX_NOTE_REPLIES, fmtRelative, fmtAbsolute, rotationFor } from "./types";
import NoteDetailModal from "./NoteDetailModal";

type Props = {
  note: DeskNote;
  variant: "received" | "sent";
  onMarkRead?: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onToggleArchive?: (id: string, archived: boolean) => void;
  onDelete?: (id: string) => void;
  onConvertedToReminder?: (id: string, reminderId: string) => void;
  onReplied?: (id: string) => void;
};

export default function DeskNotePostIt({
  note,
  variant,
  onMarkRead,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onConvertedToReminder,
  onReplied,
}: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const rotation = rotationFor(note.id);
  const unread = variant === "received" && !note.read;
  // §7/§8: solo el destinatario puede eliminar definitivamente, y solo desde Archivadas.
  const canDeleteDefinitively = variant === "received" && note.archived;
  const canDelete = (variant === "sent" && note.isMine) || canDeleteDefinitively;

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10, rotate: rotation }}
        animate={{ opacity: 1, y: 0, rotate: rotation }}
        whileHover={{ rotate: 0, y: -6, transition: { duration: 0.18, ease: "easeOut" } }}
        exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onClick={() => setShowDetail(true)}
        className={`group relative border border-border rounded-2xl shadow-[var(--shadow)] hover:shadow-[var(--shadow2)] overflow-hidden transition-shadow cursor-pointer ${COLOR_BG_CLASSES[note.color]}`}
      >
        <div className="h-[6px] w-full rounded-t-2xl" style={{ background: PRIORITY_STRIPE[note.priority] }} />

        {unread && (
          <span
            className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary"
            title="Pendiente"
            aria-label="Pendiente"
          />
        )}

        <div className="px-4 pt-3 pb-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            {note.pinned && <Pin className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2} fill="currentColor" />}
            <p className="text-[13px] font-semibold text-title truncate">
              {variant === "sent" ? note.recipientName : note.senderName}
            </p>
          </div>

          <p className="text-[13.5px] text-main leading-snug whitespace-pre-wrap break-words line-clamp-6 min-h-[3.5rem]">
            {note.message}
          </p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {note.hasAttachment && (
              <a
                href={`/api/desk-notes/${note.id}/attachment`}
                download
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:text-primary-hover bg-primary-surface px-2 py-1 rounded-lg truncate max-w-full"
                title={`Descargar ${note.attachmentName}`}
              >
                <Paperclip className="w-3 h-3 shrink-0" strokeWidth={2} />
                <span className="truncate">{note.attachmentName}</span>
              </a>
            )}
            {note.replyCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-secondary bg-surface2 px-2 py-1 rounded-lg">
                <MessageCircle className="w-3 h-3 shrink-0" strokeWidth={2} />
                {note.replyCount}/{MAX_NOTE_REPLIES}
              </span>
            )}
          </div>

          {note.convertedToReminderId && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-secondary">
              <ListTodo className="w-3 h-3 shrink-0" strokeWidth={2} />
              Convertida en recordatorio
            </p>
          )}

          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/70">
            <p className="text-[11px] text-secondary" title={fmtAbsolute(note.createdAt)}>
              {fmtRelative(note.createdAt)}
            </p>
            {variant === "sent" &&
              (note.read ? (
                <span className="flex items-center gap-1 text-[11px] text-primary" title={note.readAt ? `Leída ${fmtAbsolute(note.readAt)}` : "Leída"}>
                  <CheckCheck className="w-3.5 h-3.5" strokeWidth={2} />
                  Leída
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-secondary" title="Entregada, aún no leída">
                  <Check className="w-3.5 h-3.5" strokeWidth={2} />
                  Entregada
                </span>
              ))}
          </div>
        </div>

        {/* Acciones — ocultas hasta hover, mismo criterio que el pedido (§Acciones). */}
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {variant === "received" && (
            <IconButton title={note.pinned ? "Desfijar" : "Fijar"} onClick={(e) => { e.stopPropagation(); onTogglePin?.(note.id, !note.pinned); }}>
              {note.pinned ? <PinOff className="w-3.5 h-3.5" strokeWidth={2} /> : <Pin className="w-3.5 h-3.5" strokeWidth={2} />}
            </IconButton>
          )}
          {variant === "received" && (
            <IconButton
              title={note.archived ? "Restaurar al Escritorio" : "Archivar"}
              onClick={(e) => { e.stopPropagation(); onToggleArchive?.(note.id, !note.archived); }}
            >
              {note.archived ? <ArchiveRestore className="w-3.5 h-3.5" strokeWidth={2} /> : <Archive className="w-3.5 h-3.5" strokeWidth={2} />}
            </IconButton>
          )}
          {canDelete && (
            <IconButton title={canDeleteDefinitively ? "Eliminar definitivamente" : "Eliminar"} danger onClick={(e) => { e.stopPropagation(); onDelete?.(note.id); }}>
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </motion.div>

      {showDetail && (
        <NoteDetailModal
          note={note}
          variant={variant}
          onClose={() => setShowDetail(false)}
          onRead={() => onMarkRead?.(note.id)}
          onConvertedToReminder={(reminderId) => onConvertedToReminder?.(note.id, reminderId)}
          onReplied={() => onReplied?.(note.id)}
        />
      )}
    </>
  );
}

function IconButton({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`w-6 h-6 flex items-center justify-center rounded-full bg-surface2/90 backdrop-blur-sm border border-border shadow-sm transition-colors ${
        danger ? "text-secondary hover:text-danger hover:bg-danger-soft" : "text-secondary hover:text-primary hover:bg-primary-surface"
      }`}
    >
      {children}
    </button>
  );
}
