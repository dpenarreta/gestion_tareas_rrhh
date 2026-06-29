"use client";

import { useState, useCallback } from "react";
import type { Task, ViewType, AssignableUser } from "./types";
import KanbanView from "./KanbanView";
import TableView from "./TableView";
import GanttView from "./GanttView";
import AddViewPanel from "./AddViewPanel";
import TaskFormModal from "./TaskFormModal";

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
};

export default function TasksModule({ initialTasks, initialViews, initialUsers, currentUserId }: Props) {
  const defaultViews: ViewType[] = initialViews.length > 0 ? initialViews : ["KANBAN", "TABLA"];
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeViews, setActiveViews] = useState<ViewType[]>(defaultViews);
  const [currentView, setCurrentView] = useState<ViewType>(defaultViews[0]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [initialStatus, setInitialStatus] = useState<Task["status"]>("PENDIENTE");

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

  const handleCommentAdded = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, _count: { comments: t._count.comments + 1 } } : t
      )
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

  const allViewTypes: ViewType[] = ["KANBAN", "TABLA", "GANTT"];
  const availableViews = allViewTypes.filter((v) => !activeViews.includes(v));

  return (
    <div className="flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-end gap-0.5 border-b border-slate-200 mb-5 relative">
        {activeViews.map((view) => (
          <button
            key={view}
            onClick={() => setCurrentView(view)}
            className={`flex items-center gap-1.5 px-4 py-2.5 border-b-2 text-sm font-medium transition-colors rounded-t-lg ${
              currentView === view
                ? "border-indigo-600 text-indigo-700 bg-indigo-50/60"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            {VIEW_LABELS[view]}
            {activeViews.length > 1 && (
              <span
                onClick={(e) => removeView(view, e)}
                className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[11px] leading-none hover:bg-slate-200 hover:text-slate-800 text-slate-400 transition-colors"
                role="button"
                aria-label={`Cerrar ${VIEW_LABELS[view]}`}
              >
                ×
              </span>
            )}
          </button>
        ))}

        {availableViews.length > 0 && (
          <div className="relative ml-1 mb-0.5">
            <button
              onClick={() => setShowAddPanel(!showAddPanel)}
              className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                showAddPanel ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-xs">Vista</span>
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
      </div>

      {/* Active view */}
      <div className="flex-1">
        {currentView === "KANBAN" && (
          <KanbanView
            tasks={tasks}
            currentUserId={currentUserId}
            onStatusChange={handleStatusChange}
            onCreateTask={openCreate}
            onEditTask={openEdit}
            onDeleteTask={handleTaskDelete}
            onCommentAdded={handleCommentAdded}
          />
        )}
        {currentView === "TABLA" && (
          <TableView
            tasks={tasks}
            currentUserId={currentUserId}
            users={initialUsers}
            onFieldUpdate={handleFieldUpdate}
            onCreateTask={() => openCreate()}
            onEditTask={openEdit}
            onDeleteTask={handleTaskDelete}
            onRefresh={refreshTasks}
            onCommentAdded={handleCommentAdded}
          />
        )}
        {currentView === "GANTT" && <GanttView tasks={tasks} onCreateTask={() => openCreate()} />}
      </div>

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
