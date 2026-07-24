"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import type { Task, TaskStatus } from "@/components/tasks/types";
import CommentPanel from "@/components/tasks/CommentPanel";
import ActivityPanel from "@/components/tasks/ActivityPanel";
import TaskFormModal from "@/components/tasks/TaskFormModal";
import { formatDate, isTaskOverdue } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";
import { getOfficialTargetTime, isTargetTimeValidated } from "@/lib/targetTime";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { StatusChip, PriorityChip } from "@/components/ui/Chip";
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from "@/lib/chipConfig";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { Spinner } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClipboardList, Users } from "lucide-react";

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

// ─── MemberCard ───────────────────────────────────────────────────────────────

function MemberCard({ member, onClick }: { member: TeamMember; onClick: () => void }) {
  const pct = member.tasks.total > 0
    ? Math.round((member.tasks.completed / member.tasks.total) * 100)
    : 0;

  return (
    <button
      onClick={onClick}
      className="bg-surface rounded-2xl border border-border p-5 text-left hover:shadow-md hover:border-primary/30 transition-all group w-full"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${avatarGradient(member.name)} flex items-center justify-center shrink-0`}>
          <span className="text-base font-bold text-white">{initials(member.name)}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-title truncate group-hover:text-primary transition-colors">
            {member.name}
          </p>
          <p className="text-[11px] text-secondary truncate">{ROLE_LABEL[member.role]}</p>
          <p className="text-[11px] text-disabled truncate">{member.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatChip label="Pendiente" value={member.tasks.pending} color="text-secondary bg-surface2" />
        <StatChip label="En curso" value={member.tasks.inProgress} color="text-primary bg-primary-surface" />
        <StatChip label="Listas" value={member.tasks.completed} color="text-success bg-success/[.13]" />
      </div>

      {member.tasks.total > 0 && (
        <div>
          <div className="flex justify-between text-[10px] text-disabled mb-1">
            <span>{member.tasks.total} tareas</span>
            <span>{pct}% completado</span>
          </div>
          <div className="h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {member.tasks.total === 0 && (
        <p className="text-[11px] text-disabled">Sin tareas asignadas</p>
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

const FREQUENCY_LABELS: Record<string, string> = {
  MENSUAL: "Mensual", SEMANAL: "Semanal", DIARIA: "Diaria",
  QUINCENAL: "Quincenal", PUNTUAL: "Puntual",
};

const STATUS_SECTIONS: {
  id: TaskStatus;
  label: string;
  headerBg: string;
  headerText: string;
  dot: string;
}[] = [
  { id: "PENDIENTE", label: "Pendientes", headerBg: "bg-warning/[.15]", headerText: "text-warning", dot: "bg-warning" },
  { id: "EN_PROGRESO", label: "En Progreso", headerBg: "bg-primary-surface", headerText: "text-primary", dot: "bg-primary" },
  { id: "COMPLETADA", label: "Completadas", headerBg: "bg-success/[.13]", headerText: "text-success", dot: "bg-success" },
];

type SortKey = "title" | "status" | "priority" | "startDate" | "endDate" | "estimatedHours" | "realHours" | "comments";

function MemberTaskRow({ task, onCommentClick, onActivityClick }: {
  task: Task;
  onCommentClick: (task: Task) => void;
  onActivityClick: (task: Task) => void;
}) {
  return (
    <motion.tr
      layout
      layoutId={task.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
    >
      <Td className="max-w-[200px]">
        <p className="text-sm font-medium text-title truncate" title={task.title}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-[10px] text-disabled truncate mt-0.5">{task.description}</p>
        )}
      </Td>
      <Td className="whitespace-nowrap">
        {FREQUENCY_LABELS[task.frequency] ?? task.frequency}
      </Td>
      <Td>
        <span className="inline-block cursor-not-allowed" title="Solo el responsable puede cambiar el estado">
          <StatusChip value={task.status} config={TASK_STATUS_CONFIG} />
        </span>
      </Td>
      <Td>
        <PriorityChip value={task.priority} config={TASK_PRIORITY_CONFIG} />
      </Td>
      <Td className="whitespace-nowrap text-xs">{formatDate(task.startDate)}</Td>
      <Td className="whitespace-nowrap text-xs">
        <span className={isTaskOverdue(task.endDate, task.status) ? "text-danger font-semibold" : "text-main"}>
          {formatDate(task.endDate)}
        </span>
      </Td>
      <Td className="text-right text-xs">
        {hoursToDisplay(getOfficialTargetTime(task))}h
        {isTargetTimeValidated(task) && <span className="ml-1 text-success" title="Tiempo objetivo validado">✓</span>}
      </Td>
      <Td className="text-right text-secondary text-xs">{hoursToDisplay(task.realHours)}h</Td>
      <Td className="text-center">
        <div className="inline-flex items-center gap-2">
          <button
            onClick={() => onActivityClick(task)}
            className="text-gray-400 hover:text-primary transition-colors"
            title="Ver actividades"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={() => onCommentClick(task)}
            className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {task._count.comments}
          </button>
        </div>
      </Td>
    </motion.tr>
  );
}

function MemberTasksTable({
  tasks,
  onCommentClick,
  onActivityClick,
}: {
  tasks: Task[];
  onCommentClick: (task: Task) => void;
  onActivityClick: (task: Task) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ COMPLETADA: true });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedTasks = useMemo(() => {
    if (!sortKey) return tasks;
    const PRIORITY_ORDER: Record<string, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
    return [...tasks].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "title": av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "status": av = a.status; bv = b.status; break;
        case "priority": av = PRIORITY_ORDER[a.priority] ?? 9; bv = PRIORITY_ORDER[b.priority] ?? 9; break;
        case "startDate": av = a.startDate; bv = b.startDate; break;
        case "endDate": av = a.endDate; bv = b.endDate; break;
        case "estimatedHours": av = getOfficialTargetTime(a); bv = getOfficialTargetTime(b); break;
        case "realHours": av = a.realHours; bv = b.realHours; break;
        case "comments": av = a._count.comments; bv = b._count.comments; break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [tasks, sortKey, sortDir]);

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  if (tasks.length === 0) {
    return <EmptyState icon={ClipboardList} title="No tiene tareas asignadas" className="py-16" />;
  }

  const tasksBySection = Object.fromEntries(
    STATUS_SECTIONS.map((s) => [s.id, sortedTasks.filter((t) => t.status === s.id)])
  ) as Record<TaskStatus, Task[]>;

  return (
    <div className="flex flex-col gap-4">
      {STATUS_SECTIONS.map((section) => {
        const sectionTasks = tasksBySection[section.id];
        const isCollapsed = collapsed[section.id];
        return (
          <div key={section.id} className="rounded-2xl border border-border bg-surface overflow-hidden">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))}
              className={`flex items-center gap-2 w-full px-4 py-2.5 ${section.headerBg}`}
            >
              <svg
                className={`w-3.5 h-3.5 ${section.headerText} transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <span className={`w-2 h-2 rounded-full ${section.dot}`} />
              <span className={`text-sm font-semibold ${section.headerText}`}>
                {section.label} ({sectionTasks.length})
              </span>
            </button>

            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  style={{ overflow: "hidden" }}
                >
                  <Table>
                    <TableHead>
                      <tr className="border-b border-border">
                        <Th onDoubleClick={() => handleSort("title")} className="cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Título<SortIcon col="title" /></Th>
                        <Th>Frecuencia</Th>
                        <Th onDoubleClick={() => handleSort("status")} className="cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Estado<SortIcon col="status" /></Th>
                        <Th onDoubleClick={() => handleSort("priority")} className="cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Prioridad<SortIcon col="priority" /></Th>
                        <Th onDoubleClick={() => handleSort("startDate")} className="cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Inicio<SortIcon col="startDate" /></Th>
                        <Th onDoubleClick={() => handleSort("endDate")} className="cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Fin<SortIcon col="endDate" /></Th>
                        <Th onDoubleClick={() => handleSort("estimatedHours")} className="text-right cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">T. Objetivo<SortIcon col="estimatedHours" /></Th>
                        <Th onDoubleClick={() => handleSort("realHours")} className="text-right cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">H. Reales<SortIcon col="realHours" /></Th>
                        <Th onDoubleClick={() => handleSort("comments")} className="text-center cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Coment.<SortIcon col="comments" /></Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      <AnimatePresence initial={false}>
                        {sectionTasks.length === 0 && (
                          <TableRow>
                            <Td colSpan={9} className="p-0">
                              <EmptyState title="Sin tareas en esta sección" className="py-6" />
                            </Td>
                          </TableRow>
                        )}
                        {sectionTasks.map((task) => (
                          <MemberTaskRow
                            key={task.id}
                            task={task}
                            onCommentClick={onCommentClick}
                            onActivityClick={onActivityClick}
                          />
                        ))}
                      </AnimatePresence>
                    </TableBody>
                  </Table>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ─── TeamModule ───────────────────────────────────────────────────────────────

type Props = {
  currentUserId: string;
  currentUserRole: Role;
};

export default function TeamModule({ currentUserId, currentUserRole }: Props) {
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

  // Deep link desde una notificación: ?openTask=<taskId>&member=<memberId>
  const searchParams = useSearchParams();
  const openTaskId = searchParams.get("openTask");
  const openMemberId = searchParams.get("member");
  const autoSelectedRef = useRef(false);
  const autoOpenedTaskRef = useRef(false);

  // Load member list
  const loadMembers = useCallback(async () => {
    const res = await fetch("/api/team");
    if (res.ok) setMembers(await res.json());
    setMembersLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(loadMembers); }, [loadMembers]);

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

  // Deep link desde una notificación: selecciona al miembro dueño de la tarea automáticamente.
  useEffect(() => {
    if (!openMemberId || autoSelectedRef.current || members.length === 0) return;
    const member = members.find((m) => m.id === openMemberId);
    if (member) {
      autoSelectedRef.current = true;
      queueMicrotask(() => selectMember(member));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMemberId, members]);

  // Una vez cargadas las tareas del miembro seleccionado, abre el panel de comentarios de la tarea del enlace.
  useEffect(() => {
    if (!openTaskId || autoOpenedTaskRef.current || memberTasks.length === 0) return;
    const match = memberTasks.find((t) => t.id === openTaskId);
    if (match) {
      autoOpenedTaskRef.current = true;
      queueMicrotask(() => setCommentTask(match));
    }
  }, [openTaskId, memberTasks]);

  function goBack() {
    setSelectedMember(null);
    setMemberTasks([]);
    loadMembers(); // refresh task summaries
  }

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
        <Spinner className="w-6 h-6 text-primary" />
      </div>
    );
  }

  if (members.length === 0) {
    return <EmptyState icon={Users} title="No tienes subordinados asignados" className="py-24" />;
  }

  return (
    <>
      {/* ── Member list ───────────────────────────────────────────────────── */}
      {!selectedMember && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <p className="text-sm text-secondary">
              {members.length} {members.length === 1 ? "integrante" : "integrantes"}
            </p>
            <Button onClick={() => openAssign()} className="rounded-xl">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Asignar tarea
            </Button>
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
          <BackLink label="Equipo" onClick={goBack} className="mb-3" />
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient(selectedMember.name)} flex items-center justify-center`}>
                <span className="text-lg font-bold text-white">{initials(selectedMember.name)}</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-title">{selectedMember.name}</h1>
                <p className="text-sm text-secondary">{ROLE_LABEL[selectedMember.role]}</p>
                <p className="text-xs text-disabled">{selectedMember.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {/* mini stats */}
              <div className="hidden sm:flex items-center gap-2">
                <MiniStat label="Pendiente" value={selectedMember.tasks.pending} color="bg-surface2 text-secondary" />
                <MiniStat label="En curso" value={selectedMember.tasks.inProgress} color="bg-primary-surface text-primary" />
                <MiniStat label="Listas" value={selectedMember.tasks.completed} color="bg-success/[.13] text-success" />
              </div>
              <Button onClick={() => openAssign(selectedMember.id)} className="rounded-xl">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Asignar tarea
              </Button>
            </div>
          </div>

          {memberTasksLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="w-6 h-6 text-primary" />
            </div>
          ) : (
            <MemberTasksTable
              tasks={memberTasks}
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
          currentUserRole={currentUserRole}
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
