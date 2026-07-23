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
  archive: { icon: "🗃️", text: "El archivo está vacío (las notas se purgan a los 15 días)" },
  sent: { icon: "✉️", text: "Aún no has dejado notas a nadie" },
};

export default function NotesPanel({ onNoteCreated }: { onNoteCreated?: () => void }) {
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

  // Una nota puede estar cacheada en más de una pestaña a la vez (ej. el
  // modal de detalle se abrió desde Escritorio) — se actualiza en todas para
  // que no queden desincronizadas al volver a esa pestaña.
  function patchNoteEverywhere(id: string, patch: Partial<DeskNote>) {
    const apply = (list: DeskNote[] | null) => list?.map((n) => (n.id === id ? { ...n, ...patch } : n)) ?? list;
    setDeskNotes(apply);
    setArchiveNotes(apply);
    setSentNotes(apply);
  }

  function removeNoteEverywhere(id: string) {
    const apply = (list: DeskNote[] | null) => list?.filter((n) => n.id !== id) ?? list;
    setDeskNotes(apply);
    setArchiveNotes(apply);
    setSentNotes(apply);
  }

  async function markRead(id: string) {
    patchNoteEverywhere(id, { read: true });
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    });
  }

  async function togglePin(id: string, pinned: boolean) {
    patchNoteEverywhere(id, { pinned });
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: pinned ? "pin" : "unpin" }),
    });
  }

  async function toggleArchive(id: string, archived: boolean) {
    removeNoteEverywhere(id);
    setArchiveNotes(null);
    await fetch(`/api/desk-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: archived ? "archive" : "unarchive" }),
    });
    if (tab === "archive") loadArchive();
    if (!archived) loadDesk();
  }

  // §7/§8: eliminación definitiva por el destinatario (solo desde Archivadas)
  // o eliminación por el remitente (papelera) — mismo endpoint, la API
  // decide cuál corresponde según quién llama.
  async function deleteNote(id: string) {
    removeNoteEverywhere(id);
    await fetch(`/api/desk-notes/${id}`, { method: "DELETE" });
  }

  function convertedToReminder(id: string, reminderId: string) {
    patchNoteEverywhere(id, { convertedToReminderId: reminderId, convertedAt: new Date().toISOString() });
  }

  function replied(id: string) {
    const apply = (list: DeskNote[] | null) => list?.map((n) => (n.id === id ? { ...n, replyCount: n.replyCount + 1 } : n)) ?? list;
    setDeskNotes(apply);
    setArchiveNotes(apply);
    setSentNotes(apply);
  }

  const activeNotes: DeskNote[] | null =
    tab === "desk" ? deskNotes : tab === "pinned" ? (deskNotes?.filter((n) => n.pinned) ?? deskNotes) : tab === "archive" ? archiveNotes : sentNotes;

  const variant: "received" | "sent" = tab === "sent" ? "sent" : "received";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto flex-1">
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
        <button
          onClick={() => setShowNewNote(true)}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-xl transition-colors shrink-0"
        >
          + Nueva nota
        </button>
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
                onToggleArchive={toggleArchive}
                onDelete={deleteNote}
                onConvertedToReminder={convertedToReminder}
                onReplied={replied}
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
            onNoteCreated?.();
          }}
        />
      )}
    </div>
  );
}
