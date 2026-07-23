"use client";

import { motion } from "framer-motion";
import { Check, Pin, PinOff, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { type DeskNote, PRIORITY_STRIPE, fmtRelative, rotationFor } from "./types";

type Props = {
  note: DeskNote;
  variant: "received" | "sent";
  onMarkRead?: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onToggleArchive?: (id: string, archived: boolean) => void;
  onDelete?: (id: string) => void;
};

export default function DeskNotePostIt({ note, variant, onMarkRead, onTogglePin, onToggleArchive, onDelete }: Props) {
  const rotation = rotationFor(note.id);
  const unread = variant === "received" && !note.read;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, rotate: rotation }}
      animate={{ opacity: 1, y: 0, rotate: rotation }}
      whileHover={{ rotate: 0, y: -6, transition: { duration: 0.18, ease: "easeOut" } }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="group relative bg-surface border border-border rounded-2xl shadow-[var(--shadow)] hover:shadow-[var(--shadow2)] overflow-hidden transition-shadow"
    >
      <div className="h-[6px] w-full rounded-t-2xl" style={{ background: PRIORITY_STRIPE[note.priority] }} />

      {unread && (
        <span
          className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary"
          title="No leída"
          aria-label="No leída"
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

        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/70">
          <p className="text-[11px] text-secondary">{fmtRelative(note.createdAt)}</p>
          {variant === "sent" && (
            <p className="text-[11px] text-secondary">{note.read ? "Leída" : "No leída"}</p>
          )}
        </div>
      </div>

      {/* Acciones — ocultas hasta hover, mismo criterio que el pedido (§Acciones). */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {variant === "received" && !note.read && (
          <IconButton title="Marcar leída" onClick={() => onMarkRead?.(note.id)}>
            <Check className="w-3.5 h-3.5" strokeWidth={2} />
          </IconButton>
        )}
        {variant === "received" && (
          <IconButton title={note.pinned ? "Desfijar" : "Fijar"} onClick={() => onTogglePin?.(note.id, !note.pinned)}>
            {note.pinned ? <PinOff className="w-3.5 h-3.5" strokeWidth={2} /> : <Pin className="w-3.5 h-3.5" strokeWidth={2} />}
          </IconButton>
        )}
        {variant === "received" && (
          <IconButton
            title={note.archived ? "Restaurar al Escritorio" : "Archivar"}
            onClick={() => onToggleArchive?.(note.id, !note.archived)}
          >
            {note.archived ? <ArchiveRestore className="w-3.5 h-3.5" strokeWidth={2} /> : <Archive className="w-3.5 h-3.5" strokeWidth={2} />}
          </IconButton>
        )}
        {variant === "sent" && note.isMine && (
          <IconButton title="Eliminar" danger onClick={() => onDelete?.(note.id)}>
            <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
          </IconButton>
        )}
      </div>
    </motion.div>
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
  onClick: () => void;
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
