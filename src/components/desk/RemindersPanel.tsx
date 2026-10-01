"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Clock, CheckCircle2, Archive } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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

const EMPTY_ICON: Record<View, LucideIcon> = {
  PENDIENTE: Clock,
  COMPLETADO: CheckCircle2,
  ARCHIVADO: Archive,
};

function queryFor(view: View): string {
  return view === "ARCHIVADO" ? "archived=true" : `status=${view}`;
}

export default function RemindersPanel({ onChanged }: { onChanged?: () => void }) {
  const [view, setView] = useState<View>("PENDIENTE");
  const [reminders, setReminders] = useState<PersonalReminder[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<PersonalReminder | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // Se obtiene una sola vez para todas las tarjetas, no por ReminderCard (ver /api/settings/snooze-presets).
  const [snoozePresetsMinutes, setSnoozePresetsMinutes] = useState<number[] | undefined>(undefined);

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

  useEffect(() => {
    queueMicrotask(() => {
      fetch("/api/settings/snooze-presets")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data?.minutes && setSnoozePresetsMinutes(data.minutes))
        .catch(() => {});
    });
  }, []);

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

  // Un recordatorio se borra de verdad (`reminder.delete()` en Django, sin
  // papelera), asi que el icono solo abre la confirmacion.
  async function confirmRemove() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setRemoving(true);
    try {
      setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
      await fetch(`/api/desk-reminders/${id}`, { method: "DELETE" });
      onChanged?.();
    } finally {
      setRemoving(false);
      setPendingDeleteId(null);
    }
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
        <Button variant="primary" onClick={() => setShowNew(true)}>
          + Nuevo recordatorio
        </Button>
      </div>

      {reminders === null ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : reminders.length === 0 ? (
        <EmptyState
          icon={EMPTY_ICON[view]}
          title={EMPTY_TEXT[view]}
          className="bg-surface border border-border rounded-2xl"
        />
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
                onDelete={setPendingDeleteId}
                onConvertedToTask={convertedToTask}
                snoozePresetsMinutes={snoozePresetsMinutes}
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

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Eliminar recordatorio"
        message={`¿Eliminar "${reminders?.find((r) => r.id === pendingDeleteId)?.title ?? "este recordatorio"}"? No hay papelera de recordatorios: no se puede deshacer.`}
        confirmLabel="Eliminar"
        danger
        loading={removing}
        onConfirm={confirmRemove}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
