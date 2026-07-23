"use client";

import { useEffect, useState } from "react";
import { fmtDueDateTime, describeDeskEvent, type DeskAuditEvent } from "./types";

type Props = {
  entityType: "NOTE" | "REMINDER";
  entityId: string;
  title: string;
  onClose: () => void;
};

// Historial visible de una nota o un recordatorio (§10/§4 Auditoría) —
// compartido entre ambas entidades, lee DeskAuditLog vía el endpoint
// correspondiente a cada una.
export default function DeskHistoryModal({ entityType, entityId, title, onClose }: Props) {
  const [events, setEvents] = useState<DeskAuditEvent[] | null>(null);

  useEffect(() => {
    const url = entityType === "NOTE" ? `/api/desk-notes/${entityId}/history` : `/api/desk-reminders/${entityId}/history`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [entityType, entityId]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-title">Historial</h2>
            <p className="text-xs text-secondary truncate">{title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors shrink-0">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {events === null ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-disabled text-center py-6">Sin eventos registrados</p>
          ) : (
            <ol className="relative border-l border-border ml-1.5 space-y-4">
              {events.map((e) => (
                <li key={e.id} className="pl-4">
                  <span className="absolute -left-[5px] mt-1.5 w-2 h-2 rounded-full bg-primary" />
                  <p className="text-xs text-disabled">{fmtDueDateTime(e.createdAt)}</p>
                  <p className="text-sm text-title">{describeDeskEvent(e)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
