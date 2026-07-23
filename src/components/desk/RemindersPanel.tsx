"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReminderCard from "./ReminderCard";
import NewReminderModal from "./NewReminderModal";
import type { PersonalReminder, ReminderStatus } from "./types";

export default function RemindersPanel({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<ReminderStatus>("PENDIENTE");
  const [reminders, setReminders] = useState<PersonalReminder[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<PersonalReminder | null>(null);

  const load = useCallback((s: ReminderStatus) => {
    setReminders(null);
    fetch(`/api/desk-reminders?status=${s}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setReminders)
      .catch(() => setReminders([]));
  }, []);

  useEffect(() => {
    queueMicrotask(() => load(status));
  }, [status, load]);

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
    load(status);
  }

  async function remove(id: string) {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, { method: "DELETE" });
    onChanged?.();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(["PENDIENTE", "COMPLETADO"] as ReminderStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-xs font-medium px-3.5 py-2 transition-colors ${
                status === s ? "bg-primary text-white" : "text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {s === "PENDIENTE" ? "Pendientes" : "Completados"}
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
          {status === "PENDIENTE" ? "Sin recordatorios pendientes" : "Sin recordatorios completados"}
        </div>
      ) : (
        <motion.div layout className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {reminders.map((r) => (
              <ReminderCard key={r.id} reminder={r} onComplete={complete} onPostpone={postpone} onEdit={setEditing} onDelete={remove} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {showNew && (
        <NewReminderModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            load(status);
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
            load(status);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
