"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DeskNotePostIt from "./DeskNotePostIt";
import NewNoteModal from "./NewNoteModal";
import type { DeskNote } from "./types";

type Tab = "desk" | "pinned" | "archive" | "sent";

const TABS: { key: Tab; label: string }[] = [
  { key: "desk", label: "Escritorio" },
  { key: "pinned", label: "Fijadas" },
  { key: "archive", label: "Archivo" },
  { key: "sent", label: "Enviadas" },
];

const EMPTY_COPY: Record<Tab, { icon: string; text: string }> = {
  desk: { icon: "🗒️", text: "Tu escritorio está despejado — sin notas pendientes" },
  pinned: { icon: "📌", text: "No tienes notas fijadas" },
  archive: { icon: "🗃️", text: "El archivo está vacío" },
  sent: { icon: "✉️", text: "Aún no has dejado notas a nadie" },
};

export default function DeskBoard() {
  const [tab, setTab] = useState<Tab>("desk");
  const [deskNotes, setDeskNotes] = useState<DeskNote[] | null>(null);
  const [archiveNotes, setArchiveNotes] = useState<DeskNote[] | null>(null);
  const [sentNotes, setSentNotes] = useState<DeskNote[] | null>(null);
  const [showNewNote, setShowNewNote] = useState(false);

  const loadDesk = useCallback(() => {
    fetch("/api/desk-notes?view=desk")
      .then((r) => (r.ok ? r.json() : []))
      .then(setDeskNotes)
      .catch(() => setDeskNotes([]));
  }, []);

  const loadArchive = useCallback(() => {
    fetch("/api/desk-notes?view=archive")
      .then((r) => (r.ok ? r.json() : []))
      .then(setArchiveNotes)
      .catch(() => setArchiveNotes([]));
  }, []);

  const loadSent = useCallback(() => {
    fetch("/api/desk-notes?view=sent")
      .then((r) => (r.ok ? r.json() : []))
      .then(setSentNotes)
      .catch(() => setSentNotes([]));
  }, []);

  useEffect(() => {
    queueMicrotask(loadDesk);
  }, [loadDesk]);

  useEffect(() => {
    if (tab === "archive" && archiveNotes === null) loadArchive();
    if (tab === "sent" && sentNotes === null) loadSent();
  }, [tab, archiveNotes, sentNotes, loadArchive, loadSent]);

  async function markRead(id: string) {
    setDeskNotes((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    });
  }

  async function togglePin(id: string, pinned: boolean) {
    setDeskNotes((prev) => prev?.map((n) => (n.id === id ? { ...n, pinned } : n)) ?? prev);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: pinned ? "pin" : "unpin" }),
    });
    loadDesk();
  }

  async function toggleArchive(id: string, archived: boolean) {
    setDeskNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    setArchiveNotes(null);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: archived ? "archive" : "unarchive" }),
    });
    if (tab === "archive") loadArchive();
  }

  async function restoreFromArchive(id: string) {
    setArchiveNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    setDeskNotes(null);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unarchive" }),
    });
  }

  async function deleteNote(id: string) {
    setSentNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    await fetch(`/api/desk-notes/${id}`, { method: "DELETE" });
  }

  const activeNotes: DeskNote[] | null =
    tab === "desk" ? deskNotes : tab === "pinned" ? (deskNotes?.filter((n) => n.pinned) ?? deskNotes) : tab === "archive" ? archiveNotes : sentNotes;

  const variant: "received" | "sent" = tab === "sent" ? "sent" : "received";

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-title">Escritorio Digital</h1>
          <p className="text-sm text-secondary">Notas rápidas entre colaboradores — no reemplazan tareas ni comentarios.</p>
        </div>
        <button
          onClick={() => setShowNewNote(true)}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-xl transition-colors"
        >
          + Nueva nota
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-secondary hover:text-title"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeNotes === null ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activeNotes.length === 0 ? (
        <div className="text-center text-disabled text-sm py-16 bg-surface border border-border rounded-2xl">
          <p className="text-3xl mb-2">{EMPTY_COPY[tab].icon}</p>
          {EMPTY_COPY[tab].text}
        </div>
      ) : (
        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <AnimatePresence mode="popLayout">
            {activeNotes.map((note) => (
              <DeskNotePostIt
                key={note.id}
                note={note}
                variant={variant}
                onMarkRead={markRead}
                onTogglePin={togglePin}
                onToggleArchive={tab === "archive" ? () => restoreFromArchive(note.id) : toggleArchive}
                onDelete={deleteNote}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {showNewNote && (
        <NewNoteModal
          onClose={() => setShowNewNote(false)}
          onCreated={() => {
            setShowNewNote(false);
            loadDesk();
            setSentNotes(null);
          }}
        />
      )}
    </div>
  );
}
