"use client";

import { useEffect, useState } from "react";
import { PRIORITY_STRIPE, REMINDER_PRIORITY_COLOR, fmtRelative, fmtDueRelative, type DeskNotePriority, type ReminderPriority } from "./types";

type TodayData = {
  pendingNotes: { id: string; message: string; priority: DeskNotePriority; createdAt: string; senderName: string }[];
  todayReminders: { id: string; title: string; dueAt: string; priority: ReminderPriority; overdue: boolean }[];
  upcomingTasks: { id: string; title: string; endDate: string; priority: string; status: string }[];
  recentProjects: { id: string; name: string; status: string; updatedAt: string }[];
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

function Block({
  icon,
  title,
  count,
  emptyText,
  children,
}: {
  icon: string;
  title: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 shadow-[var(--shadow)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-title flex items-center gap-1.5">
          <span>{icon}</span> {title}
        </h3>
        {count > 0 && <span className="text-[11px] font-medium text-secondary bg-surface2 px-2 py-0.5 rounded-full">{count}</span>}
      </div>
      {count === 0 ? (
        <p className="text-xs text-disabled py-3 text-center">{emptyText}</p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </div>
  );
}

export default function TodayInbox({ onGoToNotes }: { onGoToNotes: () => void }) {
  const [data, setData] = useState<TodayData | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      fetch("/api/desk/today")
        .then((r) => (r.ok ? r.json() : null))
        .then(setData)
        .catch(() => setData(null));
    });
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Block icon="📌" title="Notas recibidas" count={data.pendingNotes.length} emptyText="Sin notas pendientes de leer">
        {data.pendingNotes.map((n) => (
          <li key={n.id}>
            <button onClick={onGoToNotes} className="w-full flex items-start gap-2 text-left p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <span className="w-1.5 h-6 rounded-full shrink-0 mt-0.5" style={{ background: PRIORITY_STRIPE[n.priority] }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-title truncate">{n.message}</p>
                <p className="text-[10px] text-secondary">{n.senderName} · {fmtRelative(n.createdAt)}</p>
              </div>
            </button>
          </li>
        ))}
      </Block>

      <Block icon="⏰" title="Recordatorios de hoy" count={data.todayReminders.length} emptyText="Nada pendiente para hoy">
        {data.todayReminders.map((r) => (
          <li key={r.id} className="flex items-center gap-2 p-2 rounded-lg">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: REMINDER_PRIORITY_COLOR[r.priority] }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-title truncate">{r.title}</p>
              <p className={`text-[10px] ${r.overdue ? "text-danger font-medium" : "text-secondary"}`}>{fmtDueRelative(r.dueAt)}</p>
            </div>
          </li>
        ))}
      </Block>

      <Block icon="📋" title="Tareas próximas a vencer" count={data.upcomingTasks.length} emptyText="Sin tareas por vencer esta semana">
        {data.upcomingTasks.map((t) => (
          <li key={t.id}>
            <a href="/tasks" className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <span className="text-xs text-title truncate">{t.title}</span>
              <span className="text-[10px] text-secondary shrink-0">{fmtDate(t.endDate)}</span>
            </a>
          </li>
        ))}
      </Block>

      <Block icon="🚀" title="Proyectos con actividad reciente" count={data.recentProjects.length} emptyText="Sin actividad reciente en tus proyectos">
        {data.recentProjects.map((p) => (
          <li key={p.id}>
            <a href={`/projects/${p.id}`} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <span className="text-xs text-title truncate">{p.name}</span>
              <span className="text-[10px] text-secondary shrink-0">{fmtRelative(p.updatedAt)}</span>
            </a>
          </li>
        ))}
      </Block>
    </div>
  );
}
