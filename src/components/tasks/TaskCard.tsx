"use client";

import { useEffect, useRef, useState } from "react";
import type { Task } from "./types";
import { TASK_COLORS, taskColorHex } from "./colors";
import { formatDate, isTaskOverdue } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

const PRIORITY_VARIANT: Record<Task["priority"], "danger" | "warning" | "success"> = {
  ALTA: "danger",
  MEDIA: "warning",
  BAJA: "success",
};

const FREQUENCY_LABELS: Record<Task["frequency"], string> = {
  MENSUAL: "Mensual",
  SEMANAL: "Semanal",
  DIARIA: "Diaria",
  QUINCENAL: "Quincenal",
  PUNTUAL: "Puntual",
};

function ColorPicker({ current, onSelect, onClose }: { current: string | null; onSelect: (color: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-8 right-0 z-20 bg-surface border border-border rounded-xl shadow-xl p-2.5 grid grid-cols-5 gap-1.5 w-[152px]"
    >
      {TASK_COLORS.map((c) => (
        <button
          key={c.value}
          title={c.label}
          onClick={() => { onSelect(c.value === current ? null : c.value); onClose(); }}
          className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
            current === c.value ? "border-title" : "border-white"
          }`}
          style={{ backgroundColor: c.hex, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }}
        />
      ))}
    </div>
  );
}

type Props = {
  task: Task;
  currentUserId: string;
  isDragging?: boolean;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onCommentClick: (task: Task) => void;
  onActivityClick?: (task: Task) => void;
  onColorChange?: (id: string, color: string | null) => void;
};

export default function TaskCard({ task, currentUserId, isDragging, onEdit, onDelete, onCommentClick, onActivityClick, onColorChange }: Props) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const isOwner = task.assignedTo.id === currentUserId;
  const hex = taskColorHex(task.color);
  const overdue = isTaskOverdue(task.endDate, task.status);

  return (
    <div
      className={`relative bg-surface rounded-xl border border-border p-3 shadow-sm select-none ${
        isDragging ? "shadow-lg rotate-1 opacity-90" : "hover:shadow-md"
      } transition-all`}
      style={hex ? { borderLeft: `4px solid ${hex}`, backgroundColor: `${hex}0d` } : undefined}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-title leading-snug line-clamp-2 flex-1">{task.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          {isOwner && onColorChange && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowColorPicker((v) => !v); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 text-disabled hover:text-primary rounded"
              aria-label="Color de tarjeta"
              title="Color de tarjeta"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h10a2 2 0 002-2v-2a2 2 0 00-2-2h-2.5M7 21a3.999 3.999 0 003.998-4H7v4z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task); }}
            className="p-1 text-disabled hover:text-primary rounded"
            aria-label="Editar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
            className="p-1 text-disabled hover:text-danger rounded"
            aria-label="Eliminar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        {showColorPicker && isOwner && onColorChange && (
          <ColorPicker
            current={task.color}
            onSelect={(color) => onColorChange(task.id, color)}
            onClose={() => setShowColorPicker(false)}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <Badge variant={PRIORITY_VARIANT[task.priority]} className="rounded normal-case">
          {task.priority}
        </Badge>
        <span className="text-[10px] text-secondary bg-surface2 px-1.5 py-0.5 rounded border border-border">
          {FREQUENCY_LABELS[task.frequency]}
        </span>
      </div>

      <div className="mb-2.5">
        {task.type === "SEGUIMIENTO" ? (
          <Badge variant="info">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Seguimiento
          </Badge>
        ) : (
          <Badge variant="neutral">Fija</Badge>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className={`flex items-center gap-1 text-[10px] ${overdue ? "text-danger font-semibold" : "text-secondary"}`}>
          Vence {formatDate(task.endDate)}
          {overdue && (
            <span className="text-[9px] font-bold uppercase tracking-wide bg-danger/10 text-danger px-1.5 py-0.5 rounded-full">
              Vencida
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {task.type === "SEGUIMIENTO" && onActivityClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onActivityClick(task); }}
              className="flex items-center gap-1 text-[10px] text-secondary hover:text-primary transition-colors"
              title="Registro de actividades"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onCommentClick(task); }}
            className="relative flex items-center gap-1 text-[10px] text-secondary hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {task._count.comments}
            {task.hasUnreadComments && (
              <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-danger" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
