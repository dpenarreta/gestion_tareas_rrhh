"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReminderCard from "./ReminderCard";
import NewReminderModal from "./NewReminderModal";
import type { PersonalReminder } from "./types";

type View = "PENDIENTE" | "COMPLETADO" | "ARCHIVADO";

const VIEW_LABEL: Record<View, string> = {
  PENDIENTE: "Pendientes",
  COMPLETADO: "Completados",
  ARCHIVADO: "Archivados",
};

const EMPTY_TEXT: Record<View, string> = {
  PENDIENTE: "Sin recordatorios pendientes",
  COMPLETADO: "Sin recordatorios completados",
  ARCHIVADO: "Sin recordatorios archivados",
};

function queryFor(view: View): string {
  return view === "ARCHIVADO" ? "archived=true" : `status=${view}`;
}

export default function RemindersPanel({ onChanged }: { onChanged?: () => void }) {
  const [view, setView] = useState<View>("PENDIENTE");
  const [reminders, setReminders] = useState<PersonalReminder[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<PersonalReminder | null>(null);

  const load = useCallback((v: View) => {
    setReminders(null);
    fetch(`/api/desk-reminders?${queryFor(v)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setReminders)
      .catch(() => setReminders([]));
  }, []);

  useEffect(() => {
    queueMicrotask(() => load(view));
  }, [view, load]);

  async function complete(id: string) {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    onChanged?.();
  }

  async function postpone(id: string, dueAt: string) {
    setReminders((prev) => prev?.map((r) => (r.id === id ? { ...r, dueAt } : r)) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "postpone", dueAt }),
    });
    load(view);
  }

  // Reabrir siempre saca el recordatorio de Completados/Archivados (vuelve a Pendiente).
  async function reopen(id: string, dueAt?: string) {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", ...(dueAt ? { dueAt } : {}) }),
    });
    onChanged?.();
  }

  async function archive(id: string, archived: boolean) {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: archived ? "archive" : "unarchive" }),
    });
    onChanged?.();
  }

  async function remove(id: string) {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, { method: "DELETE" });
    onChanged?.();
  }

  function convertedToTask(id: string, taskId: string) {
    setReminders((prev) => prev?.map((r) => (r.id === id ? { ...r, convertedToTaskId: taskId, convertedToTaskAt: new Date().toISOString() } : r)) ?? prev);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(["PENDIENTE", "COMPLETADO", "ARCHIVADO"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs font-medium px-3.5 py-2 transition-colors ${
                view === v ? "bg-primary text-white" : "text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-xl transition-colors"
        >
          + Nuevo recordatorio
        </button>
      </div>

      {reminders === null ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reminders.length === 0 ? (
        <div className="text-center text-disabled text-sm py-16 bg-surface border border-border rounded-2xl">
          <p className="text-3xl mb-2">⏰</p>
          {EMPTY_TEXT[view]}
        </div>
      ) : (
        <motion.div layout className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {reminders.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                onComplete={complete}
                onPostpone={postpone}
                onReopen={reopen}
                onArchive={archive}
                onEdit={setEditing}
                onDelete={remove}
                onConvertedToTask={convertedToTask}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {showNew && (
        <NewReminderModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            load(view);
            onChanged?.();
          }}
        />
      )}
      {editing && (
        <NewReminderModal
          reminder={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load(view);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
