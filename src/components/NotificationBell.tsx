"use client";

import { useState, useEffect, useRef } from "react";

type Notification = {
  id: string;
  message: string;
  taskId: string | null;
  taskTitle: string | null;
  read: boolean;
  createdAt: string;
};

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch("/api/notifications");
    if (res.ok) {
      const data = await res.json();
      setUnread(data.unreadCount);
      setNotifications(data.notifications);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleOpen() {
    setOpen(!open);
    if (!open && unread > 0) {
      await fetch("/api/notifications", { method: "PATCH" });
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Notificaciones"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Notificaciones</h3>
            {notifications.length > 0 && (
              <span className="text-xs text-slate-400">{notifications.length} recientes</span>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                Sin notificaciones
              </div>
            )}
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b border-slate-50 last:border-0 ${n.read ? "" : "bg-indigo-50/40"}`}
              >
                <p className="text-sm text-slate-800 leading-snug">{n.message}</p>
                <p className="text-[10px] text-slate-400 mt-1">{formatRelative(n.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
