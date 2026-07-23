"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import DeskNotePostIt from "@/components/desk/DeskNotePostIt";
import NewNoteModal from "@/components/desk/NewNoteModal";
import type { DeskNote } from "@/components/desk/types";

const WIDGET_LIMIT = 4;

export default function DeskNotesWidget() {
  const [notes, setNotes] = useState<DeskNote[] | null>(null);
  const [showNewNote, setShowNewNote] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/desk-notes?view=desk&limit=${WIDGET_LIMIT}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DeskNote[]) => setNotes(data))
      .catch(() => setNotes([]));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function markRead(id: string) {
    setNotes((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    });
  }

  async function togglePin(id: string, pinned: boolean) {
    setNotes((prev) => prev?.map((n) => (n.id === id ? { ...n, pinned } : n)) ?? prev);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: pinned ? "pin" : "unpin" }),
    });
    load();
  }

  async function toggleArchive(id: string, archived: boolean) {
    setNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: archived ? "archive" : "unarchive" }),
    });
  }

  return (
    <div className="rounded-[16px] p-5 bg-surface border border-border shadow-[var(--shadow)]">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
        <h2 className="text-[11px] font-semibold text-secondary uppercase tracking-[.07em]">Escritorio Digital</h2>
        <button
          onClick={() => setShowNewNote(true)}
          className="text-xs font-medium text-primary hover:text-primary-hover px-2 py-1 rounded-lg hover:bg-primary-surface transition-colors"
        >
          + Nueva nota
        </button>
      </div>

      {notes === null ? (
        <div className="h-32 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-2xl mb-2">🗒️</p>
          <p className="text-sm text-secondary">Tu escritorio está despejado</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <AnimatePresence mode="popLayout">
            {notes.map((note) => (
              <DeskNotePostIt
                key={note.id}
                note={note}
                variant="received"
                onMarkRead={markRead}
                onTogglePin={togglePin}
                onToggleArchive={toggleArchive}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <a
        href="/desk"
        className="mt-4 block text-center text-xs font-medium text-primary hover:text-primary-hover py-2 rounded-xl hover:bg-primary-surface transition-colors"
      >
        Ver todas →
      </a>

      {showNewNote && (
        <NewNoteModal
          onClose={() => setShowNewNote(false)}
          onCreated={() => {
            setShowNewNote(false);
            load();
          }}
        />
      )}
    </div>
  );
}
