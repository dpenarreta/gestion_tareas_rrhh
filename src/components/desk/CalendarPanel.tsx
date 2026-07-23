"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { REMINDER_PRIORITY_COLOR, PRIORITY_STRIPE, type PersonalReminder, type DeskNote } from "./types";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function monthLabel(d: Date) {
  return d.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Celdas del mes visible, incluyendo días del mes anterior/siguiente para completar semanas (lunes primero). */
function buildMonthGrid(monthStart: Date): Date[] {
  const firstWeekday = (monthStart.getDay() + 6) % 7; // 0 = lunes
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - firstWeekday);

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

/**
 * Vista personal de calendario (§12) — recordatorios + notas pendientes,
 * ambos propios. NO lee ni modifica Reuniones (módulo aparte).
 */
export default function CalendarPanel() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [notes, setNotes] = useState<DeskNote[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - 7);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 7);
    fetch(`/api/desk-reminders?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setReminders)
      .catch(() => setReminders([]));
    fetch("/api/desk-notes?view=desk")
      .then((r) => (r.ok ? r.json() : []))
      .then((all: DeskNote[]) => setNotes(all.filter((n) => !n.read)))
      .catch(() => setNotes([]));
  }, [cursor]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const remindersByDay = useMemo(() => {
    const map = new Map<string, PersonalReminder[]>();
    for (const r of reminders) {
      const key = dayKey(new Date(r.dueAt));
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [reminders]);

  const notesByDay = useMemo(() => {
    const map = new Map<string, DeskNote[]>();
    for (const n of notes) {
      const key = dayKey(new Date(n.createdAt));
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [notes]);

  const todayKey = dayKey(new Date());
  const selected = selectedDay ? { reminders: remindersByDay.get(selectedDay) ?? [], notes: notesByDay.get(selectedDay) ?? [] } : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-title capitalize">{monthLabel(cursor)}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="p-1.5 rounded-lg text-secondary hover:text-title hover:bg-surface2"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
          </button>
          <button
            onClick={() => setCursor(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })}
            className="text-xs font-medium text-primary px-2 py-1 rounded-lg hover:bg-primary-surface"
          >
            Hoy
          </button>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="p-1.5 rounded-lg text-secondary hover:text-title hover:bg-surface2"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-center text-[11px] font-semibold text-secondary py-2">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayReminders = remindersByDay.get(key) ?? [];
            const dayNotes = notesByDay.get(key) ?? [];
            const hasItems = dayReminders.length + dayNotes.length > 0;
            return (
              <button
                key={key}
                onClick={() => setSelectedDay(hasItems ? key : null)}
                className={`min-h-[76px] border-t border-l first:border-l-0 border-border p-1.5 text-left align-top transition-colors ${
                  inMonth ? "bg-surface" : "bg-background/50"
                } ${key === todayKey ? "ring-1 ring-inset ring-primary" : ""} ${hasItems ? "hover:bg-primary-surface cursor-pointer" : ""}`}
              >
                <span className={`text-[11px] ${inMonth ? "text-title" : "text-disabled"} ${key === todayKey ? "font-bold text-primary" : ""}`}>
                  {d.getDate()}
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {dayReminders.slice(0, 3).map((r) => (
                    <span key={r.id} className="w-1.5 h-1.5 rounded-full" style={{ background: REMINDER_PRIORITY_COLOR[r.priority] }} />
                  ))}
                  {dayNotes.slice(0, 3).map((n) => (
                    <span key={n.id} className="w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_STRIPE[n.priority] }} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
          <h4 className="text-xs font-semibold text-secondary uppercase tracking-wide">{selectedDay}</h4>
          {selected.reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm text-title">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: REMINDER_PRIORITY_COLOR[r.priority] }} />
              ⏰ {r.title}
            </div>
          ))}
          {selected.notes.map((n) => (
            <div key={n.id} className="flex items-center gap-2 text-sm text-title">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_STRIPE[n.priority] }} />
              📌 {n.message.length > 60 ? `${n.message.slice(0, 60)}…` : n.message} — {n.senderName}
            </div>
          ))}
          {selected.reminders.length + selected.notes.length === 0 && (
            <p className="text-xs text-disabled">Sin elementos este día.</p>
          )}
        </div>
      )}
    </div>
  );
}
