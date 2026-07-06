"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingReminder } from "@/components/tasks/types";
import TimeInput24 from "@/components/ui/TimeInput24";

const POLL_INTERVAL_MS = 10 * 60 * 1000;

function formatDateTimeLocal(d: Date): { date: string; time: string } {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

export default function ReminderNotifier() {
  const router = useRouter();
  const [queue, setQueue] = useState<PendingReminder[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleDescription, setRescheduleDescription] = useState("");

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders/pending");
      if (!res.ok) return;
      const data: PendingReminder[] = await res.json();
      if (Array.isArray(data)) setQueue(data);
    } catch {
      // silent — next poll will retry
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  const current = queue[0] ?? null;

  useEffect(() => {
    setShowSnooze(false);
    setShowReschedule(false);
    if (current) {
      const d = new Date(Date.now() + 24 * 3600 * 1000);
      const { date, time } = formatDateTimeLocal(d);
      setRescheduleDate(date);
      setRescheduleTime(time);
      setRescheduleDescription(current.description ?? "");
    }
  }, [current?.id]);

  function dismissCurrent() {
    setQueue((prev) => prev.slice(1));
  }

  async function patchCurrent(body: Record<string, unknown>) {
    if (!current || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/reminders/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) dismissCurrent();
    } finally {
      setBusy(false);
    }
  }

  function handleGoToTask() {
    dismissCurrent();
    router.push("/tasks");
  }

  function handleSnooze(offsetMs: number) {
    patchCurrent({ snoozedUntil: new Date(Date.now() + offsetMs).toISOString() });
  }

  function handleReschedule() {
    if (!rescheduleDate || !rescheduleTime) return;
    const reminderAt = new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString();
    patchCurrent({ reminderAt, description: rescheduleDescription.trim() || null });
  }

  function handleComplete() {
    patchCurrent({ completed: true });
  }

  if (!current) return null;

  return (
    <div className="fixed bottom-24 right-5 z-[70] w-[340px] bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-warning/[.12]">
        <p className="text-sm font-semibold text-warning flex items-center gap-1.5">
          <span>⏰</span> Seguimiento planificado
        </p>
        <div className="flex items-center gap-2">
          {queue.length > 1 && (
            <span className="text-[11px] text-disabled font-medium">1 de {queue.length}</span>
          )}
          <button
            onClick={dismissCurrent}
            className="p-0.5 text-disabled hover:text-main"
            title="Cerrar (reaparece en 10 min)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-1">
        <p className="text-xs text-disabled truncate">{current.task.title}</p>
        <p className="text-sm font-semibold text-title">{current.title}</p>
        {current.description && (
          <p className="text-xs text-secondary leading-relaxed">{current.description}</p>
        )}
      </div>

      {showReschedule ? (
        <div className="px-4 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="w-full border border-border rounded-lg px-2.5 py-1.5 text-xs text-title bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <TimeInput24
              value={rescheduleTime}
              onChange={setRescheduleTime}
              selectClassName="w-full border border-border rounded-lg px-2 py-1.5 text-xs text-title bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <textarea
            value={rescheduleDescription}
            onChange={(e) => setRescheduleDescription(e.target.value)}
            rows={2}
            placeholder="Descripción (opcional)"
            className="w-full border border-border rounded-lg px-2.5 py-1.5 text-xs text-title bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowReschedule(false)}
              className="flex-1 text-xs font-medium text-secondary border border-border rounded-lg py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              onClick={handleReschedule}
              disabled={busy || !rescheduleDate || !rescheduleTime}
              className="flex-1 text-xs font-medium bg-primary text-white rounded-lg py-1.5 hover:bg-primary-hover disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      ) : showSnooze ? (
        <div className="px-4 pb-3 space-y-1.5">
          {[
            { label: "30 minutos", ms: 30 * 60 * 1000 },
            { label: "1 hora", ms: 60 * 60 * 1000 },
            { label: "Mañana, misma hora", ms: 24 * 60 * 60 * 1000 },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleSnooze(opt.ms)}
              disabled={busy}
              className="w-full text-left text-xs text-main px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => setShowSnooze(false)}
            className="w-full text-xs font-medium text-secondary border border-border rounded-lg py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          <button
            onClick={handleGoToTask}
            className="text-xs font-medium text-primary border border-primary/30 bg-primary-surface rounded-lg py-2 hover:bg-primary/20 transition-colors"
          >
            Ir a la tarea
          </button>
          <button
            onClick={() => setShowSnooze(true)}
            disabled={busy}
            className="text-xs font-medium text-main border border-border rounded-lg py-2 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
          >
            Posponer
          </button>
          <button
            onClick={() => setShowReschedule(true)}
            disabled={busy}
            className="text-xs font-medium text-main border border-border rounded-lg py-2 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
          >
            Reagendar
          </button>
          <button
            onClick={handleComplete}
            disabled={busy}
            className="text-xs font-medium text-white bg-success rounded-lg py-2 hover:brightness-105 transition-all disabled:opacity-40"
          >
            Marcar completado
          </button>
        </div>
      )}
    </div>
  );
}
