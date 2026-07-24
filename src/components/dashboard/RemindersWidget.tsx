"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import NewReminderModal from "@/components/desk/NewReminderModal";
import { REMINDER_PRIORITY_COLOR, fmtDueRelative, isOverdue, type PersonalReminder } from "@/components/desk/types";

const WIDGET_LIMIT = 5;

// §11 del sprint de evolución de Escritorio Digital: el widget del Dashboard
// muestra ÚNICAMENTE los próximos recordatorios (máx. 5, ordenados por
// fecha, sin completados) — las notas ya no tienen preview en el Dashboard,
// se surfacean vía el punto rojo del sidebar (§2) en su lugar.
export default function RemindersWidget() {
  const [reminders, setReminders] = useState<PersonalReminder[] | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/desk-reminders?status=PENDIENTE&limit=${WIDGET_LIMIT}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PersonalReminder[]) => setReminders(data))
      .catch(() => setReminders([]));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function complete(id: string) {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    await fetch(`/api/desk-reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    load();
  }

  return (
    <div className="rounded-[16px] p-5 bg-surface border border-border shadow-[var(--shadow)]">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
        <h2 className="text-[11px] font-semibold text-secondary uppercase tracking-[.07em]">Escritorio Digital</h2>
        <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
          + Nuevo recordatorio
        </Button>
      </div>

      <p className="text-[11px] text-secondary mb-3 -mt-1">Mis próximos recordatorios</p>

      {reminders === null ? (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
      ) : reminders.length === 0 ? (
        <EmptyState icon={Clock} title="Sin recordatorios próximos" className="py-6" />
      ) : (
        <ul className="space-y-1.5">
          <AnimatePresence mode="popLayout">
            {reminders.map((r) => {
              const overdue = isOverdue(r);
              return (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <button
                    onClick={() => complete(r.id)}
                    title="Marcar completado"
                    className="w-5 h-5 rounded-full border-2 border-border2 hover:border-success text-transparent hover:text-success/50 flex items-center justify-center shrink-0 transition-colors"
                  >
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </button>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: REMINDER_PRIORITY_COLOR[r.priority] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-title truncate">{r.title}</p>
                  </div>
                  <span className={`text-xs shrink-0 ${overdue ? "text-danger font-medium" : "text-secondary"}`}>
                    {fmtDueRelative(r.dueAt)}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      <a
        href="/desk"
        className="mt-4 block text-center text-xs font-medium text-primary hover:text-primary-hover py-2 rounded-xl hover:bg-primary-surface transition-colors"
      >
        Ver Escritorio Digital →
      </a>

      {showNew && (
        <NewReminderModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}
