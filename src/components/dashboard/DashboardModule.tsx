"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL, canCreateMeetings } from "@/lib/roles";
import TaskFormModal from "@/components/tasks/TaskFormModal";
import type { AssignableUser } from "@/components/tasks/types";
import MeetingFormModalDashboard from "@/components/meetings/MeetingFormModalDashboard";

// ── Types ─────────────────────────────────────────────────────────────────────

type PriorityTask = {
  id: string;
  title: string;
  status: string;
  endDate: string;
  urgency: number;
};

type Stats = { pending: number; inProgress: number; completed: number };

type ActivityEvent = { text: string; time: string };

type Announcement = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  expiresAt: string;
  createdAt: string;
  authorName: string;
};

type UpcomingMeeting = {
  id: string;
  title: string;
  meetingDate: string;
  duration: number;
  status: string;
  hostName: string;
};

type DashboardData = {
  workloadPct: number;
  completedPct: number;
  overdue: number;
  priorityTasks: PriorityTask[];
  stats: { today: Stats; week: Stats; month: Stats };
  areaActivity: ActivityEvent[];
  teamAlerts: number;
  announcements: Announcement[];
  lastLoginAt: string | null;
  badges: string[];
  upcomingMeetings: UpcomingMeeting[];
};

type Props = {
  userId: string;
  userName: string;
  userRole: Role;
  roleLevel: number;
  initialCardOrder: string[];
  canPost: boolean;
};

const DEFAULT_CARDS = [
  "jornada",
  "prioridades",
  "agenda",
  "actividad",
  "comunicados",
  "acciones",
  "resumen",
];

const CARD_TITLES: Record<string, string> = {
  jornada: "Mi jornada",
  prioridades: "Mis prioridades",
  agenda: "Agenda",
  actividad: "Actividad del área",
  comunicados: "Comunicados",
  acciones: "Acciones rápidas",
  resumen: "Resumen",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(name: string) {
  const h = new Date().getHours();
  const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  return `${saludo}, ${name.split(" ")[0]}`;
}

function workloadLabel(pct: number) {
  if (pct <= 80) return { text: "Puedes asumir nuevas tareas", color: "text-success", bg: "bg-success/[.13]", bar: "bg-success" };
  if (pct <= 100) return { text: "Carga adecuada", color: "text-warning", bg: "bg-warning/[.15]", bar: "bg-warning" };
  return { text: "Se recomienda no asignar nuevas tareas", color: "text-danger", bg: "bg-danger/[.13]", bar: "bg-danger" };
}

function urgencyBadge(urgency: number) {
  if (urgency === 4) return { label: "Vencida", cls: "bg-danger/[.13] text-danger border-transparent" };
  if (urgency === 3) return { label: "Hoy", cls: "bg-danger/[.13] text-danger border-transparent" };
  if (urgency === 2) return { label: "Mañana", cls: "bg-warning/[.15] text-warning border-transparent" };
  return { label: "Esta semana", cls: "bg-success/[.13] text-success border-transparent" };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)} días`;
}

// ── Sortable wrapper ──────────────────────────────────────────────────────────

function SortableCard({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${isDragging ? "opacity-50 z-50" : ""} ${className}`}
      {...attributes}
    >
      <div
        {...listeners}
        className="absolute top-3 right-3 cursor-grab active:cursor-grabbing p-1 rounded text-disabled hover:text-secondary z-10"
        title="Arrastrar para reordenar"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM14 6a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM20 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
        </svg>
      </div>
      {children}
    </div>
  );
}

function Card({
  children,
  className = "",
  focal = false,
}: {
  children: React.ReactNode;
  className?: string;
  focal?: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] p-5 ${
        focal ? "border border-primline" : "bg-surface border border-border shadow-[var(--shadow)]"
      } ${className}`}
      style={
        focal
          ? {
              background: "linear-gradient(160deg, var(--primsoft), var(--surface) 55%)",
              boxShadow: "var(--shadow2)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold text-secondary uppercase tracking-[.07em] pb-3 mb-4 border-b border-border">
      {children}
    </h2>
  );
}

// ── Individual card renderers ─────────────────────────────────────────────────

function JornadaCard({
  userName,
  userRole,
  data,
  novaMessage,
  novaLoading,
}: {
  userName: string;
  userRole: Role;
  data: DashboardData;
  novaMessage: string;
  novaLoading: boolean;
}) {
  const wl = workloadLabel(data.workloadPct);
  return (
    <Card focal>
      <CardTitle>Mi jornada</CardTitle>
      <h1 className="text-[36px] leading-tight font-bold text-title mb-1">{greeting(userName)}</h1>
      <p className="text-[13px] text-secondary mb-5">{ROLE_LABEL[userRole]}</p>

      {/* Nova message */}
      <div className="bg-primary-surface border border-primary/15 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
        <span className="text-xl shrink-0">🤖</span>
        {novaLoading ? (
          <div className="h-4 w-full bg-primary/15 animate-pulse rounded" />
        ) : (
          <p className="text-sm text-title">{novaMessage}</p>
        )}
      </div>

      {/* Workload */}
      <div className={`rounded-xl px-4 py-3 ${wl.bg}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm font-semibold ${wl.color}`}>Carga laboral</span>
          <span className={`text-lg font-bold ${wl.color}`}>{data.workloadPct}%</span>
        </div>
        <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full ${wl.bar} rounded-full transition-all`}
            style={{ width: `${Math.min(100, data.workloadPct)}%` }}
          />
        </div>
        <p className={`text-xs mt-2 ${wl.color}`}>{wl.text}</p>
      </div>
    </Card>
  );
}

function PrioridadesCard({ tasks }: { tasks: PriorityTask[] }) {
  return (
    <Card>
      <CardTitle>Mis prioridades</CardTitle>
      {tasks.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm text-secondary">Sin tareas urgentes</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const badge = urgencyBadge(t.urgency);
            return (
              <li key={t.id} className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5">
                <span className="text-sm text-title truncate flex-1">{t.title}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[13px] text-secondary">{fmtDate(t.endDate)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <a
        href="/tasks"
        className="mt-4 block text-center text-xs font-medium text-primary hover:text-primary-hover py-2 rounded-xl hover:bg-primary-surface transition-colors"
      >
        Ver todas las tareas →
      </a>
    </Card>
  );
}

function AgendaCard({
  meetings,
  canCreate,
  onNewMeeting,
}: {
  meetings: UpcomingMeeting[];
  canCreate: boolean;
  onNewMeeting: () => void;
}) {
  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateShort(iso: string) {
    return new Date(iso).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" });
  }
  function fmtDur(min: number) {
    return min < 60 ? `${min}min` : `${Math.floor(min / 60)}h${min % 60 > 0 ? `${min % 60}min` : ""}`;
  }

  return (
    <Card>
      <CardTitle>Agenda</CardTitle>
      {meetings.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-2xl mb-2">📅</p>
          <p className="text-sm text-secondary">Sin reuniones próximas</p>
        </div>
      ) : (
        <ul className="space-y-2 mb-3">
          {meetings.map((m) => (
            <li key={m.id}>
              <a href="/meetings" className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                <div className="w-10 text-center shrink-0">
                  <p className="text-xs font-bold text-primary">{fmtTime(m.meetingDate)}</p>
                  <p className="text-[10px] text-secondary">{fmtDur(m.duration)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-title truncate">{m.title}</p>
                  <p className="text-xs text-secondary">{fmtDateShort(m.meetingDate)} · {m.hostName}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <button
          onClick={onNewMeeting}
          className="w-full text-xs font-medium text-primary border border-primary/30 rounded-xl py-2 hover:bg-primary-surface transition-colors"
        >
          + Nueva reunión
        </button>
      ) : (
        <a href="/meetings" className="block text-center text-xs font-medium text-primary hover:text-primary-hover py-2 rounded-xl hover:bg-primary-surface transition-colors">
          Ver todas las reuniones →
        </a>
      )}
    </Card>
  );
}

function ActividadAreaCard({
  events,
  lastLoginAt,
}: {
  events: ActivityEvent[];
  lastLoginAt: string | null;
}) {
  return (
    <Card>
      <CardTitle>Actividad del área</CardTitle>
      {lastLoginAt && (
        <p className="text-xs text-secondary mb-3">
          Desde tu última visita el {fmtDate(lastLoginAt)} a las {fmtTime(lastLoginAt)}
        </p>
      )}
      {events.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-2xl mb-2">✓</p>
          <p className="text-sm text-secondary">Sin actividad nueva desde tu última visita</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-main">{e.text}</p>
                <p className="text-xs text-secondary">{fmtRelative(e.time)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ComunicadosCard({
  announcements,
  canPost,
  onPublish,
  onDelete,
}: {
  announcements: Announcement[];
  canPost: boolean;
  onPublish: (data: { title: string; content: string; durationDays: number; pinned: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [duration, setDuration] = useState(7);
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onPublish({ title, content, durationDays: duration, pinned });
    setTitle(""); setContent(""); setDuration(7); setPinned(false); setShowForm(false);
    setSaving(false);
  }

  if (announcements.length === 0 && !canPost) return null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wider">Comunicados</h2>
        {canPost && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs font-medium text-primary hover:text-primary-hover px-2 py-1 rounded-lg hover:bg-primary-surface transition-colors"
          >
            {showForm ? "Cancelar" : "+ Publicar"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3 bg-background rounded-xl p-4">
          <input
            required
            placeholder="Título del comunicado"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm text-title bg-surface rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <textarea
            required
            rows={3}
            placeholder="Contenido del comunicado..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full px-3 py-2 text-sm text-title bg-surface rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
          <div className="flex items-center gap-4">
            <label className="text-xs text-main">
              Duración (días):
              <input
                type="number"
                min={1}
                max={30}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="ml-2 w-16 px-2 py-1 text-sm text-title bg-surface rounded border border-border"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-main cursor-pointer">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="rounded"
              />
              Fijar arriba
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Publicando…" : "Publicar comunicado"}
          </button>
        </form>
      )}

      {announcements.length === 0 ? (
        <p className="text-sm text-secondary text-center py-4">No hay comunicados activos</p>
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <li key={a.id} className={`p-3 rounded-xl border ${a.pinned ? "border-primary/25 bg-primary-surface" : "border-border bg-background"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {a.pinned && <span className="text-xs text-primary">📌</span>}
                    <p className="text-sm font-semibold text-title">{a.title}</p>
                  </div>
                  <p className="text-sm text-main">{a.content}</p>
                  <p className="text-xs text-secondary mt-1.5">{a.authorName} · vence {fmtDate(a.expiresAt)}</p>
                </div>
                {canPost && (
                  <button
                    onClick={() => onDelete(a.id)}
                    className="text-disabled hover:text-danger p-1 rounded shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AccionesRapidasCard({
  onNewTask,
  onNewMeeting,
  canCreateMeeting,
}: {
  onNewTask: () => Promise<void>;
  onNewMeeting: () => void;
  canCreateMeeting: boolean;
}) {
  const actions = [
    { icon: "📋", label: "Nueva tarea", onClick: onNewTask },
    { icon: "🤖", label: "Consultar Nova", onClick: () => (window.location.href = "/assistant") },
    { icon: "💡", label: "Nueva idea", onClick: () => (window.location.href = "/mejora-continua") },
    {
      icon: "📅",
      label: canCreateMeeting ? "Nueva reunión" : "Ver reuniones",
      onClick: canCreateMeeting ? onNewMeeting : () => (window.location.href = "/meetings"),
    },
  ];

  return (
    <Card>
      <CardTitle>Acciones rápidas</CardTitle>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-primary-surface transition-colors group"
          >
            <span className="text-2xl">{a.icon}</span>
            <span className="text-xs font-medium text-main group-hover:text-primary">{a.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

type Period = "today" | "week" | "month";

function ResumenCard({
  stats,
  workloadPct,
  teamAlerts,
  roleLevel,
}: {
  stats: { today: Stats; week: Stats; month: Stats };
  workloadPct: number;
  teamAlerts: number;
  roleLevel: number;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const s = stats[period];
  const periods: { key: Period; label: string }[] = [
    { key: "today", label: "Hoy" },
    { key: "week", label: "Semana" },
    { key: "month", label: "Mes" },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wider">Resumen</h2>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`text-xs px-2.5 py-1 transition-colors ${
                period === p.key ? "bg-primary text-white" : "text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Pendientes" value={s.pending} color="text-warning-alt" bg="bg-warning/10" />
        <StatBox label="En progreso" value={s.inProgress} color="text-info" bg="bg-info/10" />
        <StatBox label="Completadas" value={s.completed} color="text-success" bg="bg-success/10" />
        <StatBox label="Carga laboral" value={`${workloadPct}%`} color="text-primary" bg="bg-primary-surface" />
      </div>

      {roleLevel >= 2 && teamAlerts > 0 && (
        <div className="mt-3 flex items-center gap-2 p-2.5 bg-danger/10 border border-danger/25 rounded-xl">
          <span className="text-danger">🔴</span>
          <p className="text-xs text-danger font-medium">
            Equipo: {teamAlerts} {teamAlerts === 1 ? "persona requiere" : "personas requieren"} atención
          </p>
        </div>
      )}
    </Card>
  );
}

function StatBox({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`${bg} rounded-xl p-3 text-center`}>
      <p className={`text-[34px] leading-tight font-bold ${color}`}>{value}</p>
      <p className="text-xs text-secondary mt-0.5">{label}</p>
    </div>
  );
}

// ── Main module ───────────────────────────────────────────────────────────────

export default function DashboardModule({
  userId,
  userName,
  userRole,
  roleLevel,
  initialCardOrder,
  canPost,
}: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [novaMessage, setNovaMessage] = useState("");
  const [novaLoading, setNovaLoading] = useState(true);
  const [cardOrder, setCardOrder] = useState<string[]>(initialCardOrder);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const emptyData: DashboardData = {
    workloadPct: 0, completedPct: 0, overdue: 0,
    priorityTasks: [], stats: {
      today: { pending: 0, inProgress: 0, completed: 0 },
      week: { pending: 0, inProgress: 0, completed: 0 },
      month: { pending: 0, inProgress: 0, completed: 0 },
    },
    areaActivity: [], teamAlerts: 0, announcements: [],
    lastLoginAt: null, badges: [], upcomingMeetings: [],
  };

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        const d: DashboardData = await res.json();
        setData(d);

        // Fetch Nova message (non-blocking — failures don't affect the rest)
        const NOVA_FALLBACK = "Bienvenido a Nexo. Revisa tus tareas pendientes para comenzar el día.";
        setNovaLoading(true);
        fetch("/api/dashboard/nova-message", { method: "POST" })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
          .then((n) => setNovaMessage(n.message || NOVA_FALLBACK))
          .catch(() => setNovaMessage(NOVA_FALLBACK))
          .finally(() => setNovaLoading(false));
      } else {
        setData(emptyData);
        setNovaLoading(false);
      }
    } catch {
      setData(emptyData);
      setNovaLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userName, userRole]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = cardOrder.indexOf(active.id as string);
    const newIndex = cardOrder.indexOf(over.id as string);
    const newOrder = arrayMove(cardOrder, oldIndex, newIndex);
    setCardOrder(newOrder);

    fetch("/api/dashboard/card-order", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: newOrder }),
    });
  }

  async function handlePublishAnnouncement(formData: {
    title: string;
    content: string;
    durationDays: number;
    pinned: boolean;
  }) {
    await fetch("/api/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    fetchData();
  }

  async function handleDeleteAnnouncement(id: string) {
    await fetch(`/api/announcements/${id}`, { method: "DELETE" });
    fetchData();
  }

  // Cards visible (hide Comunicados if empty and not canPost)
  const visibleCards = cardOrder.filter((id) => {
    if (id === "comunicados" && !canPost && (data?.announcements.length ?? 0) === 0) return false;
    return true;
  });

  function renderCard(cardId: string) {
    if (!data) {
      return (
        <Card>
          <div className="h-32 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </Card>
      );
    }

    switch (cardId) {
      case "jornada":
        return (
          <JornadaCard
            userName={userName}
            userRole={userRole}
            data={data}
            novaMessage={novaMessage}
            novaLoading={novaLoading}
          />
        );
      case "prioridades":
        return <PrioridadesCard tasks={data.priorityTasks} />;
      case "agenda":
        return (
          <AgendaCard
            meetings={data.upcomingMeetings}
            canCreate={canCreateMeetings(userRole)}
            onNewMeeting={() => setShowMeetingModal(true)}
          />
        );
      case "actividad":
        return <ActividadAreaCard events={data.areaActivity} lastLoginAt={data.lastLoginAt} />;
      case "comunicados":
        return (
          <ComunicadosCard
            announcements={data.announcements}
            canPost={canPost}
            onPublish={handlePublishAnnouncement}
            onDelete={handleDeleteAnnouncement}
          />
        );
      case "acciones":
        return (
          <AccionesRapidasCard
            canCreateMeeting={canCreateMeetings(userRole)}
            onNewMeeting={() => setShowMeetingModal(true)}
            onNewTask={async () => {
              if (assignableUsers.length === 0) {
                const res = await fetch("/api/users/assignable");
                if (res.ok) setAssignableUsers(await res.json());
              }
              setShowTaskModal(true);
            }}
          />
        );
      case "resumen":
        return (
          <ResumenCard
            stats={data.stats}
            workloadPct={data.workloadPct}
            teamAlerts={data.teamAlerts}
            roleLevel={roleLevel}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div>
      <DndContext id="dashboard-cards" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleCards} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {visibleCards.map((cardId) => {
              const content = renderCard(cardId);
              if (!content) return null;
              return (
                <SortableCard
                  key={cardId}
                  id={cardId}
                  className={cardId === "jornada" ? "xl:col-span-2" : ""}
                >
                  {content}
                </SortableCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {showTaskModal && (
        <TaskFormModal
          task={null}
          initialStatus="PENDIENTE"
          users={assignableUsers}
          currentUserId={userId}
          onClose={() => setShowTaskModal(false)}
          onSave={() => { setShowTaskModal(false); fetchData(); }}
        />
      )}
      {showMeetingModal && (
        <MeetingFormModalDashboard
          onClose={() => setShowMeetingModal(false)}
          onSaved={() => { setShowMeetingModal(false); fetchData(); }}
          currentUserId={userId}
        />
      )}
    </div>
  );
}
