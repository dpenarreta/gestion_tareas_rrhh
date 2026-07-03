"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import type { Task, TaskStatus } from "./types";
import TaskCard from "./TaskCard";
import CommentPanel from "./CommentPanel";
import ActivityPanel from "./ActivityPanel";
import { fireCelebrationConfetti } from "@/lib/confetti";

const COLUMNS: { id: TaskStatus; label: string; headerColor: string; dotColor: string }[] = [
  { id: "PENDIENTE", label: "Pendiente", headerColor: "text-main", dotColor: "bg-slate-400" },
  { id: "EN_PROGRESO", label: "En Progreso", headerColor: "text-blue-700", dotColor: "bg-blue-500" },
  { id: "COMPLETADA", label: "Completada", headerColor: "text-green-700", dotColor: "bg-green-500" },
];

function DroppableColumn({
  column,
  tasks,
  currentUserId,
  collapsed,
  onToggleCollapse,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onCommentClick,
  onActivityClick,
  onColorChange,
}: {
  column: (typeof COLUMNS)[0];
  tasks: Task[];
  currentUserId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCreateTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onCommentClick: (task: Task) => void;
  onActivityClick: (task: Task) => void;
  onColorChange: (id: string, color: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-2xl border-2 transition-colors ${collapsed ? "" : "min-h-[400px]"} ${
        isOver ? "border-primary bg-primary-surface/50" : "border-border bg-background"
      }`}
    >
      <div className="p-3 border-b border-border flex items-center justify-between">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 min-w-0"
          title={collapsed ? "Expandir columna" : "Colapsar columna"}
        >
          <svg
            className={`w-3.5 h-3.5 shrink-0 ${column.headerColor} transition-transform ${collapsed ? "-rotate-90" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span className={`w-2 h-2 rounded-full shrink-0 ${column.dotColor}`} />
          <span className={`text-sm font-semibold truncate ${column.headerColor}`}>{column.label}</span>
          <span className="text-xs text-disabled bg-surface border border-border px-1.5 py-0.5 rounded-full shrink-0">
            {tasks.length}
          </span>
        </button>
        <button
          onClick={() => onCreateTask(column.id)}
          className="p-1 text-disabled hover:text-primary hover:bg-surface rounded-lg transition-colors shrink-0"
          title="Nueva tarea"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="flex-1 p-3 space-y-2">
              {tasks.map((task) => (
                <DraggableCard
                  key={task.id}
                  task={task}
                  currentUserId={currentUserId}
                  onEdit={onEditTask}
                  onDelete={onDeleteTask}
                  onCommentClick={onCommentClick}
                  onActivityClick={onActivityClick}
                  onColorChange={onColorChange}
                />
              ))}
              {tasks.length === 0 && (
                <div className="flex flex-col items-center justify-center h-24 text-disabled text-xs">
                  <svg className="w-6 h-6 mb-1 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Sin tareas
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DraggableCard({
  task,
  currentUserId,
  onEdit,
  onDelete,
  onCommentClick,
  onActivityClick,
  onColorChange,
}: {
  task: Task;
  currentUserId: string;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onCommentClick: (task: Task) => void;
  onActivityClick: (task: Task) => void;
  onColorChange: (id: string, color: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        currentUserId={currentUserId}
        isDragging={false}
        onEdit={onEdit}
        onDelete={onDelete}
        onCommentClick={onCommentClick}
        onActivityClick={onActivityClick}
        onColorChange={onColorChange}
      />
    </div>
  );
}

type Props = {
  tasks: Task[];
  currentUserId: string;
  onStatusChange: (id: string, status: TaskStatus) => Promise<void>;
  onCreateTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onCommentAdded: (taskId: string) => void;
  onColorChange: (id: string, color: string | null) => void;
};

export default function KanbanView({
  tasks,
  currentUserId,
  onStatusChange,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onCommentAdded,
  onColorChange,
}: Props) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [activityTask, setActivityTask] = useState<Task | null>(null);
  const [collapsed, setCollapsed] = useState<Record<TaskStatus, boolean>>({
    PENDIENTE: false,
    EN_PROGRESO: false,
    COMPLETADA: true,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;
    const newStatus = over.id as TaskStatus;
    const task = tasks.find((t) => t.id === active.id);
    if (task && task.status !== newStatus) {
      if (newStatus === "COMPLETADA" && task.assignedTo.id === currentUserId) {
        const rect = active.rect.current.translated ?? active.rect.current.initial;
        if (rect) fireCelebrationConfetti(rect);
      }
      await onStatusChange(String(active.id), newStatus);
    }
  }

  const tasksByStatus = Object.fromEntries(
    COLUMNS.map((col) => [col.id, tasks.filter((t) => t.status === col.id)])
  ) as Record<TaskStatus, Task[]>;

  return (
    <>
      <DndContext id="kanban-board" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-3 gap-4 h-full">
          {COLUMNS.map((col) => (
            <DroppableColumn
              key={col.id}
              column={col}
              tasks={tasksByStatus[col.id]}
              currentUserId={currentUserId}
              collapsed={collapsed[col.id]}
              onToggleCollapse={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
              onCreateTask={onCreateTask}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onCommentClick={setCommentTask}
              onActivityClick={setActivityTask}
              onColorChange={onColorChange}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && (
            <div className="opacity-90 rotate-2 shadow-2xl">
              <TaskCard
                task={activeTask}
                currentUserId={currentUserId}
                isDragging
                onEdit={() => {}}
                onDelete={() => {}}
                onCommentClick={() => {}}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {commentTask && (
        <CommentPanel
          task={commentTask}
          currentUserId={currentUserId}
          onClose={() => setCommentTask(null)}
          onCommentAdded={() => onCommentAdded(commentTask.id)}
        />
      )}

      {activityTask && (
        <ActivityPanel
          task={activityTask}
          currentUserId={currentUserId}
          onClose={() => setActivityTask(null)}
        />
      )}
    </>
  );
}
