"use client";

import { useState } from "react";
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

const COLUMNS: { id: TaskStatus; label: string; headerColor: string; dotColor: string }[] = [
  { id: "PENDIENTE", label: "Pendiente", headerColor: "text-slate-600", dotColor: "bg-slate-400" },
  { id: "EN_PROGRESO", label: "En Progreso", headerColor: "text-blue-700", dotColor: "bg-blue-500" },
  { id: "COMPLETADA", label: "Completada", headerColor: "text-green-700", dotColor: "bg-green-500" },
];

function DroppableColumn({
  column,
  tasks,
  currentUserId,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onCommentClick,
}: {
  column: (typeof COLUMNS)[0];
  tasks: Task[];
  currentUserId: string;
  onCreateTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onCommentClick: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-2xl border-2 transition-colors min-h-[400px] ${
        isOver ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="p-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${column.dotColor}`} />
          <span className={`text-sm font-semibold ${column.headerColor}`}>{column.label}</span>
          <span className="text-xs text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => onCreateTask(column.id)}
          className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors"
          title="Nueva tarea"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      <div className="flex-1 p-3 space-y-2">
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            currentUserId={currentUserId}
            onEdit={onEditTask}
            onDelete={onDeleteTask}
            onCommentClick={onCommentClick}
          />
        ))}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 text-slate-400 text-xs">
            <svg className="w-6 h-6 mb-1 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Sin tareas
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  task,
  currentUserId,
  onEdit,
  onDelete,
  onCommentClick,
}: {
  task: Task;
  currentUserId: string;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onCommentClick: (task: Task) => void;
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
};

export default function KanbanView({
  tasks,
  currentUserId,
  onStatusChange,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onCommentAdded,
}: Props) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [commentTask, setCommentTask] = useState<Task | null>(null);

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
      await onStatusChange(String(active.id), newStatus);
    }
  }

  const tasksByStatus = Object.fromEntries(
    COLUMNS.map((col) => [col.id, tasks.filter((t) => t.status === col.id)])
  ) as Record<TaskStatus, Task[]>;

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-3 gap-4 h-full">
          {COLUMNS.map((col) => (
            <DroppableColumn
              key={col.id}
              column={col}
              tasks={tasksByStatus[col.id]}
              currentUserId={currentUserId}
              onCreateTask={onCreateTask}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onCommentClick={setCommentTask}
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
    </>
  );
}
