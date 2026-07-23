"use client";

import { useState } from "react";
import { fmtDueDateTime, type PersonalReminder } from "./types";

type Props = {
  reminder: PersonalReminder;
  onClose: () => void;
  onReopen: (dueAt?: string) => void;
};

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

// §3 del refinamiento: Opción A (mantener fecha/hora original) u Opción B
// (elegir nueva fecha/hora) — nunca crea un recordatorio nuevo, solo
// reprograma el existente.
export default function ReopenReminderModal({ reminder, onClose, onReopen }: Props) {
  const [choosingNewDate, setChoosingNewDate] = useState(false);
  const initial = splitDateTime(reminder.dueAt);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  function confirmNewDate() {
    if (!date || !time) return;
    onReopen(new Date(`${date}T${time}:00`).toISOString());
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-title">Reabrir recordatorio</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-title font-medium truncate">{reminder.title}</p>

          {!choosingNewDate ? (
            <div className="space-y-2.5">
              <button
                onClick={() => onReopen(undefined)}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary-surface transition-colors"
              >
                <p className="text-sm font-medium text-title">Mantener fecha y hora original</p>
                <p className="text-xs text-secondary mt-0.5">{fmtDueDateTime(reminder.dueAt)}</p>
              </button>
              <button
                onClick={() => setChoosingNewDate(true)}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary-surface transition-colors"
              >
                <p className="text-sm font-medium text-title">Elegir nueva fecha y hora</p>
                <p className="text-xs text-secondary mt-0.5">Reprogramar antes de reabrir</p>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-main mb-1.5">Fecha *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-main mb-1.5">Hora *</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={confirmNewDate}
                  disabled={!date || !time}
                  className="flex-1 py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  Reabrir con esta fecha
                </button>
                <button
                  onClick={() => setChoosingNewDate(false)}
                  className="px-4 py-2.5 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
                >
                  Volver
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
