"use client";

import { useState, useEffect, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { Task } from "@/components/tasks/types";
import CommentPanel from "@/components/tasks/CommentPanel";
import ActivityPanel from "@/components/tasks/ActivityPanel";
import TaskFormModal from "@/components/tasks/TaskFormModal";

// ─── types ────────────────────────────────────────────────────────────────────

type TaskSummary = { total: number; completed: number; inProgress: number; pending: number };

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tasks: TaskSummary;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-indigo-500",
  "from-violet-500 to-purple-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
];

function avatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL");
}

function fmtH(n: number) {
  return Math.round(n * 100) / 100;
}

function formatRelativeDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
}

// ─── MemberCard ───────────────────────────────────────────────────────────────

function MemberCard({ member, onClick }: { member: TeamMember; onClick: () => void }) {
  const pct = member.tasks.total > 0
    ? Math.round((member.tasks.completed / member.tasks.total) * 100)
    : 0;

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:shadow-md hover:border-indigo-200 transition-all group w-full"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${avatarGradient(member.name)} flex items-center justify-center shrink-0`}>
          <span className="text-base font-bold text-white">{initials(member.name)}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-indigo-700 transition-colors">
            {member.name}
          </p>
          <p className="text-[11px] text-slate-500 truncate">{ROLE_LABEL[member.role]}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatChip label="Pendiente" value={member.tasks.pending} color="text-slate-600 bg-slate-100" />
        <StatChip label="En curso" value={member.tasks.inProgress} color="text-blue-700 bg-blue-50" />
        <StatChip label="Listas" value={member.tasks.completed} color="text-green-700 bg-green-50" />
      </div>

      {member.tasks.total > 0 && (
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>{member.tasks.total} tareas</span>
            <span>{pct}% completado</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {member.tasks.total === 0 && (
        <p className="text-[11px] text-slate-400">Sin tareas asignadas</p>
      )}
    </button>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 text-center ${color}`}>
      <p className="text-base font-bold leading-none">{value}</p>
      <p className="text-[10px] mt-0.5 leading-none">{label}</p>
    </div>
  );
}

// ─── MemberTasksTable ─────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "EN_PROGRESO", label: "En Progreso" },
  { value: "COMPLETADA", label: "Completada" },
];

const STATUS_STYLES: Record<string, string> = {
  PENDIENTE: "bg-slate-100 text-slate-700",
  EN_PROGRESO: "bg-blue-100 text-blue-700",
  COMPLETADA: "bg-green-100 text-green-700",
};

const PRIORITY_STYLES: Record<string, string> = {
  ALTA: "bg-red-100 text-red-700",
  MEDIA: "bg-yellow-100 text-yellow-700",
  BAJA: "bg-green-100 text-green-700",
};

const FREQUENCY_LABELS: Record<string, string> = {
  MENSUAL: "Mensual", SEMANAL: "Semanal", DIARIA: "Diaria",
  QUINCENAL: "Quincenal", PUNTUAL: "Puntual",
};

function MemberTasksTable({
  tasks,
  currentUserId,
  onStatusChange,
  onCommentClick,
  onActivityClick,
}: {
  tasks: Task[];
  currentUserId: string;
  onStatusChange: (id: string, status: Task["status"]) => void;
  onCommentClick: (task: Task) => void;
  onActivityClick: (task: Task) => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm">No tiene tareas asignadas</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Título</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Frecuencia</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Prioridad</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Inicio</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fin</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">H. Est.</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">H. Reales</th>
            <th className="text-center px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Avance</th>
            <th className="text-center px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Coment.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tasks.map((task) => (
            <tr key={task.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 max-w-[200px]">
                <p className="text-sm font-medium text-slate-900 truncate" title={task.title}>
                  {task.title}
                </p>
                {task.description && (
                  <p className="text-[10px] text-slate-400 truncate mt-0.5">{task.description}</p>
                )}
              </td>
              <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                {FREQUENCY_LABELS[task.frequency] ?? task.frequency}
              </td>
              <td className="px-3 py-3">
                <select
                  value={task.status}
                  onChange={(e) => onStatusChange(task.id, e.target.value as Task["status"])}
                  className={`text-xs font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 ${STATUS_STYLES[task.status]}`}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-3">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}>
                  {task.priority}
                </span>
              </td>
              <td className="px-3 py-3 text-slate-600 whitespace-nowrap text-xs">{formatDate(task.startDate)}</td>
              <td className="px-3 py-3 whitespace-nowrap text-xs">
                <span className={new Date(task.endDate) < new Date() && task.status !== "COMPLETADA" ? "text-red-600 font-medium" : "text-slate-600"}>
                  {formatRelativeDate(task.endDate)}
                </span>
              </td>
              <td className="px-3 py-3 text-right text-slate-600 text-xs">{fmtH(task.estimatedHours)}h</td>
              <td className="px-3 py-3 text-right text-slate-500 text-xs">{fmtH(task.realHours)}h</td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2 min-w-[70px]">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 w-6 text-right">{task.progress}%</span>
                </div>
              </td>
              <td className="px-3 py-3 text-center">
                <div className="inline-flex items-center gap-2">
                  {task.type === "SEGUIMIENTO" && (
                    <button
                      onClick={() => onActivityClick(task)}
                      className="text-slate-400 hover:text-violet-600 transition-colors"
                      title="Ver actividades"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onCommentClick(task)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {task._count.comments}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── TeamModule ───────────────────────────────────────────────────────────────

type Props = {
  currentUserId: string;
  currentUserRole: Role;
};

export default function TeamModule({ currentUserId, currentUserRole: _role }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [memberTasks, setMemberTasks] = useState<Task[]>([]);
  const [memberTasksLoading, setMemberTasksLoading] = useState(false);

  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [activityTask, setActivityTask] = useState<Task | null>(null);

  // assign modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignPreselect, setAssignPreselect] = useState<string | undefined>(undefined);

  // Load member list
  const loadMembers = useCallback(async () => {
    const res = await fetch("/api/team");
    if (res.ok) setMembers(await res.json());
    setMembersLoading(false);
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // Load tasks for selected member
  const loadMemberTasks = useCallback(async (memberId: string) => {
    setMemberTasksLoading(true);
    const res = await fetch(`/api/team/${memberId}/tasks`);
    if (res.ok) setMemberTasks(await res.json());
    setMemberTasksLoading(false);
  }, []);

  function selectMember(member: TeamMember) {
    setSelectedMember(member);
    setMemberTasks([]);
    loadMemberTasks(member.id);
  }

  function goBack() {
    setSelectedMember(null);
    setMemberTasks([]);
    loadMembers(); // refresh task summaries
  }

  const handleStatusChange = useCallback(async (taskId: string, status: Task["status"]) => {
    // optimistic
    setMemberTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      // revert on error
      if (selectedMember) loadMemberTasks(selectedMember.id);
    }
  }, [selectedMember, loadMemberTasks]);

  const handleCommentAdded = useCallback((taskId: string) => {
    setMemberTasks((prev) =>
      prev.map((t) => t.id === taskId ? { ...t, _count: { comments: t._count.comments + 1 } } : t)
    );
  }, []);

  function openAssign(preselect?: string) {
    setAssignPreselect(preselect);
    setShowAssignModal(true);
  }

  function handleTaskAssigned() {
    setShowAssignModal(false);
    loadMembers();
    if (selectedMember) loadMemberTasks(selectedMember.id);
  }

  // The assignable users for the modal are the members list
  const assignableUsers = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role as string,
  }));

  // ── render ──────────────────────────────────────────────────────────────────

  if (membersLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <svg className="w-12 h-12 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm">No tienes subordinados asignados</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Member list ───────────────────────────────────────────────────── */}
      {!selectedMember && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Mi Equipo</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {members.length} {members.length === 1 ? "integrante" : "integrantes"}
              </p>
            </div>
            <button
              onClick={() => openAssign()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Asignar tarea
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {members.map((m) => (
              <MemberCard key={m.id} member={m} onClick={() => selectMember(m)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Member detail ─────────────────────────────────────────────────── */}
      {selectedMember && (
        <div>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={goBack}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                title="Volver al equipo"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient(selectedMember.name)} flex items-center justify-center`}>
                <span className="text-lg font-bold text-white">{initials(selectedMember.name)}</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{selectedMember.name}</h1>
                <p className="text-sm text-slate-500">{ROLE_LABEL[selectedMember.role]}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {/* mini stats */}
              <div className="hidden sm:flex items-center gap-2">
                <MiniStat label="Pendiente" value={selectedMember.tasks.pending} color="bg-slate-100 text-slate-700" />
                <MiniStat label="En curso" value={selectedMember.tasks.inProgress} color="bg-blue-50 text-blue-700" />
                <MiniStat label="Listas" value={selectedMember.tasks.completed} color="bg-green-50 text-green-700" />
              </div>
              <button
                onClick={() => openAssign(selectedMember.id)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Asignar tarea
              </button>
            </div>
          </div>

          {memberTasksLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <MemberTasksTable
              tasks={memberTasks}
              currentUserId={currentUserId}
              onStatusChange={handleStatusChange}
              onCommentClick={setCommentTask}
              onActivityClick={setActivityTask}
            />
          )}
        </div>
      )}

      {/* ── Comment panel ─────────────────────────────────────────────────── */}
      {commentTask && (
        <CommentPanel
          task={commentTask}
          currentUserId={currentUserId}
          onClose={() => setCommentTask(null)}
          onCommentAdded={() => handleCommentAdded(commentTask.id)}
        />
      )}

      {/* ── Activity panel (read-only for superiors) ──────────────────────── */}
      {activityTask && (
        <ActivityPanel
          task={activityTask}
          currentUserId={currentUserId}
          onClose={() => setActivityTask(null)}
          readOnly
        />
      )}

      {/* ── Assign task modal ─────────────────────────────────────────────── */}
      {showAssignModal && (
        <TaskFormModal
          task={null}
          initialStatus="PENDIENTE"
          initialAssignedToId={assignPreselect}
          users={assignableUsers}
          currentUserId={currentUserId}
          onSave={handleTaskAssigned}
          onClose={() => setShowAssignModal(false)}
        />
      )}
    </>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${color}`}>
      <span className="text-sm font-bold">{value}</span>
      <span>{label}</span>
    </div>
  );
}
