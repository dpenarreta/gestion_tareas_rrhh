"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Notification = {
  id: string;
  message: string;
  taskId: string | null;
  taskTitle: string | null;
  taskAssignedToId: string | null;
  read: boolean;
  category?: string;
  createdAt: string;
};

// Alertas administrativas con categoría (Control Operativo de Novedades). El
// color nunca es la única señal: cada una lleva icono y etiqueta de texto.
const ALERT_STYLES: Record<string, { label: string; border: string; text: string; icon: string }> = {
  deletion: {
    label: "Eliminación",
    border: "border-l-4 border-l-danger",
    text: "text-danger",
    icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16",
  },
  status_change: {
    label: "Inactivo / Suspendido",
    border: "border-l-4 border-l-danger",
    text: "text-danger",
    icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
  },
  new_collaborator: {
    label: "Nuevo colaborador",
    border: "border-l-4 border-l-blue-600 dark:border-l-blue-400",
    text: "text-blue-700 dark:text-blue-300",
    icon: "M18 9v6m3-3h-6M13 7a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z",
  },
};

type Props = {
  currentUserId: string;
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

export default function NotificationBell({ currentUserId }: Props) {
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  async function load() {
    // Late sola cada 30s: se marca como de fondo para que no cuente como
    // actividad y no mantenga viva una sesión que nadie está usando (ver
    // `SESSION_IDLE_TIMEOUT_HOURS` en el backend).
    let res: Response;
    try {
      res = await fetch("/api/notifications", {
        headers: { "X-Nexo-Background": "1" },
      });
    } catch {
      return; // sin red: se reintenta en el próximo ciclo, sin error sin manejar
    }
    if (res.ok) {
      const data = await res.json();
      setUnread(data.unreadCount);
      setNotifications(data.notifications);
    }
  }

  useEffect(() => {
    queueMicrotask(load);
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

  async function markOne(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((prev) => Math.max(0, prev - 1));
  }

  function handleClick(n: Notification) {
    if (!n.read) markOne(n.id);
    setOpen(false);
    if (!n.taskId) return;
    if (n.taskAssignedToId === currentUserId) {
      router.push(`/tasks?openTask=${n.taskId}`);
    } else {
      router.push(`/team?openTask=${n.taskId}${n.taskAssignedToId ? `&member=${n.taskAssignedToId}` : ""}`);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-secondary hover:text-title hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
        aria-label="Notificaciones"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center bg-danger text-white text-[9px] font-bold rounded-full">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border rounded-2xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-title">Notificaciones</h3>
            {unread > 0 && (
              <span className="text-xs font-medium text-primary bg-primary-surface px-2 py-0.5 rounded-full">
                {unread} sin leer
              </span>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 && (
              <div className="text-center py-10 text-secondary text-sm">
                <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Sin notificaciones
              </div>
            )}
            {notifications.map((n) => {
              const alert = n.category ? ALERT_STYLES[n.category] : undefined;
              return (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                data-alert={alert ? n.category : undefined}
                className={`px-4 py-3 transition-colors ${alert ? alert.border : ""} ${
                  n.read
                    ? "bg-surface"
                    : "bg-primary-surface hover:brightness-95 dark:hover:brightness-125"
                } ${n.taskId ? "cursor-pointer" : ""}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && (
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  )}
                  <div className={!n.read ? "" : "pl-3.5"}>
                    {alert && (
                      <p className={`flex items-center gap-1 text-xs font-semibold mb-0.5 ${alert.text}`}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={alert.icon} />
                        </svg>
                        {alert.label}
                      </p>
                    )}
                    <p className="text-sm text-title leading-snug">{n.message}</p>
                    {n.taskTitle && (
                      <p className="text-[13px] text-secondary mt-0.5 truncate">{n.taskTitle}</p>
                    )}
                    <p className="text-[13px] text-secondary mt-0.5">{formatRelative(n.createdAt)}</p>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
