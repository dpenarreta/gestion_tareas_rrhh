"use client";

import type { Task } from "./types";

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  ALTA: "bg-red-100 text-red-700",
  MEDIA: "bg-yellow-100 text-yellow-700",
  BAJA: "bg-green-100 text-green-700",
};

const FREQUENCY_LABELS: Record<Task["frequency"], string> = {
  MENSUAL: "Mensual",
  SEMANAL: "Semanal",
  DIARIA: "Diaria",
  QUINCENAL: "Quincenal",
  PUNTUAL: "Puntual",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
}

type Props = {
  task: Task;
  currentUserId: string;
  isDragging?: boolean;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onCommentClick: (task: Task) => void;
  onActivityClick?: (task: Task) => void;
};

export default function TaskCard({ task, currentUserId: _cu, isDragging, onEdit, onDelete, onCommentClick, onActivityClick }: Props) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-3 shadow-sm select-none ${
        isDragging ? "shadow-lg rotate-1 opacity-90" : "hover:shadow-md"
      } transition-all`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2 flex-1">{task.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task); }}
            className="p-1 text-slate-400 hover:text-indigo-600 rounded"
            aria-label="Editar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
            className="p-1 text-slate-400 hover:text-red-600 rounded"
            aria-label="Eliminar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}>
          {task.priority}
        </span>
        <span className="text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
          {FREQUENCY_LABELS[task.frequency]}
        </span>
      </div>

      {task.type === "SEGUIMIENTO" && (
        <div className="mb-2.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Seguimiento
          </span>
        </div>
      )}

      {task.type === "FIJA" && task.progress > 0 && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-500">Avance</span>
            <span className="text-[10px] font-medium text-slate-700">{task.progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">
          Vence {formatDate(task.endDate)}
        </span>
        <div className="flex items-center gap-2">
          {task.type === "SEGUIMIENTO" && onActivityClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onActivityClick(task); }}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-violet-600 transition-colors"
              title="Registro de actividades"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onCommentClick(task); }}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {task._count.comments}
          </button>
        </div>
      </div>
    </div>
  );
}
