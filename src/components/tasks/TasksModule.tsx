"use client";

import { useState, useCallback, useMemo } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Task, ViewType, AssignableUser } from "./types";
import type { ActivityFormat } from "@/lib/activityFormat";
import { canManageUsers } from "@/lib/roles";
import KanbanView from "./KanbanView";
import TableView from "./TableView";
import GanttView from "./GanttView";
import AddViewPanel from "./AddViewPanel";
import TaskFormModal from "./TaskFormModal";
import RepositoryView from "./RepositoryView";
import CloseMonthModal from "./CloseMonthModal";

const VIEW_LABELS: Record<ViewType, string> = {
  KANBAN: "Kanban",
  TABLA: "Tabla",
  GANTT: "Gantt",
};

type Props = {
  initialTasks: Task[];
  initialViews: ViewType[];
  initialUsers: AssignableUser[];
  currentUserId: string;
  currentUserRole: Role;
  currentActivityFormat: ActivityFormat;
};

export default function TasksModule({ initialTasks, initialViews, initialUsers, currentUserId, currentUserRole, currentActivityFormat }: Props) {
  const defaultViews: ViewType[] = initialViews.length > 0 ? initialViews : ["KANBAN", "TABLA"];
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeViews, setActiveViews] = useState<ViewType[]>(defaultViews);
  const [currentView, setCurrentView] = useState<ViewType>(defaultViews[0]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [initialStatus, setInitialStatus] = useState<Task["status"]>("PENDIENTE");
  const [showRepository, setShowRepository] = useState(false);
  const [showCloseMonth, setShowCloseMonth] = useState(false);
  const [search, setSearch] = useState("");

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [tasks, search]);

  const searchActive = search.trim() !== "";
  const noSearchResults = searchActive && filteredTasks.length === 0;

  const refreshTasks = useCallback(async () => {
    const res = await fetch("/api/tasks");
    if (res.ok) {
      const data: Task[] = await res.json();
      setTasks(data);
    }
  }, []);

  const saveViewPreferences = useCallback(
    async (views: ViewType[]) => {
      await fetch(`/api/users/${currentUserId}/view-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewPreferences: views }),
      });
    },
    [currentUserId]
  );

  const addView = useCallback(
    (view: ViewType) => {
      const next = [...activeViews, view];
      setActiveViews(next);
      setCurrentView(view);
      setShowAddPanel(false);
      saveViewPreferences(next);
    },
    [activeViews, saveViewPreferences]
  );

  const removeView = useCallback(
    (view: ViewType, e: React.MouseEvent) => {
      e.stopPropagation();
      if (activeViews.length <= 1) return;
      const next = activeViews.filter((v) => v !== view);
      setActiveViews(next);
      if (currentView === view) setCurrentView(next[0]);
      saveViewPreferences(next);
    },
    [activeViews, currentView, saveViewPreferences]
  );

  const openCreate = useCallback((status: Task["status"] = "PENDIENTE") => {
    setEditingTask(null);
    setInitialStatus(status);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setFormOpen(true);
  }, []);

  const handleTaskSaved = useCallback(() => {
    setFormOpen(false);
    setEditingTask(null);
    refreshTasks();
  }, [refreshTasks]);

  const handleTaskDelete = useCallback(
    async (id: string) => {
      if (!confirm("¿Eliminar esta tarea?")) return;
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      refreshTasks();
    },
    [refreshTasks]
  );

  const handleBulkDelete = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map((id) => fetch(`/api/tasks/${id}`, { method: "DELETE" })));
      refreshTasks();
    },
    [refreshTasks]
  );

  const handleCommentAdded = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, _count: { comments: t._count.comments + 1 } } : t
      )
    );
  }, []);

  const handleCommentsViewed = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, hasUnreadComments: false } : t))
    );
  }, []);

  const handleStatusChange = useCallback(async (id: string, status: Task["status"]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } else {
      await refreshTasks();
    }
  }, [refreshTasks]);

  const handleFieldUpdate = useCallback(async (id: string, field: string, value: unknown) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    }
  }, []);

  const handleColorChange = useCallback((id: string, color: string | null) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
    handleFieldUpdate(id, "color", color);
  }, [handleFieldUpdate]);

  const allViewTypes: ViewType[] = ["KANBAN", "TABLA", "GANTT"];
  const availableViews = allViewTypes.filter((v) => !activeViews.includes(v));

  return (
    <div className="flex flex-col min-h-0">
      {/* Search */}
      <div className="mb-4 relative max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-disabled" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar tarea por nombre..."
          className="w-full pl-9 pr-9 py-2 text-sm rounded-[10px] border border-border2 bg-surface2 text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-surface transition-colors"
        />
        {searchActive && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-disabled hover:text-title p-0.5"
            aria-label="Limpiar búsqueda"
            title="Limpiar búsqueda"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center justify-between gap-2 mb-5 relative">
        <div className="flex items-center gap-0.5 bg-surface2 rounded-[10px] p-1">
          {activeViews.map((view) => (
            <button
              key={view}
              onClick={() => { setCurrentView(view); setShowRepository(false); }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
                !showRepository && currentView === view
                  ? "bg-surface text-title font-semibold shadow-[var(--shadow)]"
                  : "text-secondary hover:text-title font-medium"
              }`}
            >
              {VIEW_LABELS[view]}
              {activeViews.length > 1 && (
                <span
                  onClick={(e) => removeView(view, e)}
                  className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[11px] leading-none hover:bg-surface2 hover:text-title text-disabled transition-colors"
                  role="button"
                  aria-label={`Cerrar ${VIEW_LABELS[view]}`}
                >
                  ×
                </span>
              )}
            </button>
          ))}

          {availableViews.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowAddPanel(!showAddPanel)}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[13px] rounded-[8px] transition-colors ${
                  showAddPanel ? "bg-surface text-title shadow-[var(--shadow)]" : "text-disabled hover:text-main"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Vista</span>
              </button>
              {showAddPanel && (
                <AddViewPanel
                  availableViews={availableViews}
                  onAdd={addView}
                  onClose={() => setShowAddPanel(false)}
                />
              )}
            </div>
          )}

          <button
            onClick={() => setShowRepository(true)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
              showRepository
                ? "bg-surface text-title font-semibold shadow-[var(--shadow)]"
                : "text-secondary hover:text-title font-medium"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 01-2-2V4a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
            </svg>
            Repositorio
          </button>
        </div>

        {canManageUsers(currentUserRole) && (
          <button
            onClick={() => setShowCloseMonth(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-background bg-title rounded-[9px] hover:brightness-110 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Cerrar mes
          </button>
        )}
      </div>

      {/* Active view */}
      <div className="flex-1">
        {showRepository && <RepositoryView currentUserRole={currentUserRole} />}
        {!showRepository && noSearchResults && (
          <div className="text-center py-16 text-secondary text-sm rounded-2xl border border-border bg-surface">
            No se encontraron tareas con ese nombre
          </div>
        )}
        {!showRepository && !noSearchResults && currentView === "KANBAN" && (
          <KanbanView
            tasks={filteredTasks}
            currentUserId={currentUserId}
            activityFormat={currentActivityFormat}
            onStatusChange={handleStatusChange}
            onCreateTask={openCreate}
            onEditTask={openEdit}
            onDeleteTask={handleTaskDelete}
            onCommentAdded={handleCommentAdded}
            onCommentsViewed={handleCommentsViewed}
            onColorChange={handleColorChange}
          />
        )}
        {!showRepository && !noSearchResults && currentView === "TABLA" && (
          <TableView
            tasks={filteredTasks}
            currentUserId={currentUserId}
            activityFormat={currentActivityFormat}
            users={initialUsers}
            onFieldUpdate={handleFieldUpdate}
            onStatusChange={handleStatusChange}
            onColorChange={handleColorChange}
            onCreateTask={() => openCreate()}
            onEditTask={openEdit}
            onDeleteTask={handleTaskDelete}
            onBulkDelete={handleBulkDelete}
            onRefresh={refreshTasks}
            onCommentAdded={handleCommentAdded}
            onCommentsViewed={handleCommentsViewed}
          />
        )}
        {!showRepository && !noSearchResults && currentView === "GANTT" && <GanttView tasks={filteredTasks} onCreateTask={() => openCreate()} />}
      </div>

      {showCloseMonth && (
        <CloseMonthModal
          onClose={() => setShowCloseMonth(false)}
          onClosed={() => { refreshTasks(); }}
        />
      )}

      {formOpen && (
        <TaskFormModal
          task={editingTask}
          initialStatus={initialStatus}
          users={initialUsers}
          currentUserId={currentUserId}
          onSave={handleTaskSaved}
          onClose={() => { setFormOpen(false); setEditingTask(null); }}
        />
      )}
    </div>
  );
}
