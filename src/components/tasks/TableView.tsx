"use client";

import { useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Task, AssignableUser, TaskStatus } from "./types";
import { taskColorHex } from "./colors";
import { fireCelebrationConfetti } from "@/lib/confetti";

type SortKey = "title" | "frequency" | "status" | "priority" | "startDate" | "endDate" | "estimatedHours" | "realHours" | "progress";
import CommentPanel from "./CommentPanel";
import ActivityPanel from "./ActivityPanel";

const STATUS_LABELS: Record<Task["status"], string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En Progreso",
  COMPLETADA: "Completada",
};

const STATUS_STYLES: Record<Task["status"], string> = {
  PENDIENTE: "bg-slate-100 text-slate-700",
  EN_PROGRESO: "bg-blue-100 text-blue-700",
  COMPLETADA: "bg-green-100 text-green-700",
};

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

const STATUS_SECTIONS: {
  id: TaskStatus;
  label: string;
  headerBg: string;
  headerText: string;
  border: string;
  dot: string;
  collapsible?: boolean;
}[] = [
  { id: "PENDIENTE", label: "Pendientes", headerBg: "bg-amber-50", headerText: "text-amber-700", border: "border-amber-200", dot: "bg-amber-400" },
  { id: "EN_PROGRESO", label: "En Progreso", headerBg: "bg-blue-50", headerText: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
  { id: "COMPLETADA", label: "Completadas", headerBg: "bg-green-50", headerText: "text-green-700", border: "border-green-200", dot: "bg-green-500", collapsible: true },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL");
}

function fmtH(n: number) {
  return Math.round(n * 100) / 100;
}

function InlineEdit({
  value,
  type = "text",
  options,
  readOnly,
  onSave,
}: {
  value: string;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  function commit() {
    setEditing(false);
    if (local !== value) onSave(local);
  }

  if (readOnly) {
    return <span className="text-sm text-slate-500 cursor-not-allowed">{value}</span>;
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setLocal(value); setEditing(true); }}
        className="text-sm text-slate-800 cursor-pointer hover:text-indigo-700 hover:underline underline-offset-2"
        title="Clic para editar"
      >
        {value || "—"}
      </span>
    );
  }

  if (type === "select" && options) {
    return (
      <select
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        className="text-sm text-slate-900 bg-white border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type={type}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="text-sm text-slate-900 bg-white border border-indigo-300 rounded-lg px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-indigo-300"
    />
  );
}

function TaskRow({
  task,
  currentUserId,
  onFieldUpdate,
  onStatusChange,
  onEditTask,
  onDeleteTask,
  onCommentClick,
  onActivityClick,
}: {
  task: Task;
  currentUserId: string;
  onFieldUpdate: (id: string, field: string, value: unknown) => Promise<void>;
  onStatusChange: (id: string, status: TaskStatus) => Promise<void>;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onCommentClick: (task: Task) => void;
  onActivityClick: (task: Task) => void;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const isOwner = task.assignedTo.id === currentUserId;
  const hex = taskColorHex(task.color);

  function handleStatusSave(v: string) {
    const newStatus = v as TaskStatus;
    if (newStatus === "COMPLETADA" && task.status !== "COMPLETADA" && isOwner && rowRef.current) {
      fireCelebrationConfetti(rowRef.current.getBoundingClientRect());
    }
    onStatusChange(task.id, newStatus);
  }

  return (
    <motion.tr
      ref={rowRef}
      layout
      layoutId={task.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className="hover:bg-slate-50 transition-colors group"
    >
      <td className="w-1 p-0" style={{ backgroundColor: hex ?? "transparent" }} />
      <td className="px-4 py-3 max-w-[200px]">
        <InlineEdit
          value={task.title}
          onSave={(v) => onFieldUpdate(task.id, "title", v)}
        />
        {task.assignedTo.name !== task.createdBy.name && (
          <p className="text-[10px] text-slate-400 mt-0.5">{task.assignedTo.name}</p>
        )}
      </td>
      <td className="px-3 py-3">
        <InlineEdit
          value={task.frequency}
          type="select"
          options={[
            { value: "MENSUAL", label: "Mensual" },
            { value: "SEMANAL", label: "Semanal" },
            { value: "DIARIA", label: "Diaria" },
            { value: "QUINCENAL", label: "Quincenal" },
            { value: "PUNTUAL", label: "Puntual" },
          ]}
          onSave={(v) => onFieldUpdate(task.id, "frequency", v)}
        />
      </td>
      <td className="px-3 py-3">
        <InlineEdit
          value={task.status}
          type="select"
          options={[
            { value: "PENDIENTE", label: "Pendiente" },
            { value: "EN_PROGRESO", label: "En Progreso" },
            { value: "COMPLETADA", label: "Completada" },
          ]}
          onSave={handleStatusSave}
        />
      </td>
      <td className="px-3 py-3">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}>
          {task.priority}
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{formatDate(task.startDate)}</td>
      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{formatDate(task.endDate)}</td>
      <td className="px-3 py-3 text-right text-slate-600">{fmtH(task.estimatedHours)}h</td>
      <td className="px-3 py-3 text-right">
        <InlineEdit
          value={String(fmtH(task.realHours))}
          type="number"
          readOnly={!isOwner}
          onSave={(v) => onFieldUpdate(task.id, "realHours", v)}
        />
        <span className="text-slate-400 ml-0.5 text-xs">h</span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2 min-w-[80px]">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full"
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 w-7 text-right">{task.progress}%</span>
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        <div className="inline-flex items-center gap-2">
          {task.type === "SEGUIMIENTO" && (
            <button
              onClick={() => onActivityClick(task)}
              className="text-slate-400 hover:text-violet-600 transition-colors"
              title="Registro de actividades"
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
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEditTask(task)}
            className="p-1 text-slate-400 hover:text-indigo-600 rounded"
            title="Editar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDeleteTask(task.id)}
            className="p-1 text-slate-400 hover:text-red-600 rounded"
            title="Eliminar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

type Props = {
  tasks: Task[];
  currentUserId: string;
  users: AssignableUser[];
  onFieldUpdate: (id: string, field: string, value: unknown) => Promise<void>;
  onStatusChange: (id: string, status: TaskStatus) => Promise<void>;
  onColorChange: (id: string, color: string | null) => void;
  onCreateTask: () => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onRefresh: () => void;
  onCommentAdded: (taskId: string) => void;
};

export default function TableView({
  tasks,
  currentUserId,
  users: _users,
  onFieldUpdate,
  onStatusChange,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onRefresh,
  onCommentAdded,
}: Props) {
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [activityTask, setActivityTask] = useState<Task | null>(null);
  const [importing, setImporting] = useState(false);
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
        case "frequency": av = a.frequency; bv = b.frequency; break;
        case "status": av = a.status; bv = b.status; break;
        case "priority": av = PRIORITY_ORDER[a.priority] ?? 9; bv = PRIORITY_ORDER[b.priority] ?? 9; break;
        case "startDate": av = a.startDate; bv = b.startDate; break;
        case "endDate": av = a.endDate; bv = b.endDate; break;
        case "estimatedHours": av = a.estimatedHours; bv = b.estimatedHours; break;
        case "realHours": av = a.realHours; bv = b.realHours; break;
        case "progress": av = a.progress; bv = b.progress; break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [tasks, sortKey, sortDir]);

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return <span className="ml-1 text-indigo-500">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }
  const [importResult, setImportResult] = useState<{ imported: number; errors: { row: number; error: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    const res = await fetch("/api/tasks/template");
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_tareas.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/tasks/import", { method: "POST", body: formData });
      const data = await res.json();
      setImportResult(data);
      if (data.imported > 0) onRefresh();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const tasksBySection = Object.fromEntries(
    STATUS_SECTIONS.map((s) => [s.id, sortedTasks.filter((t) => t.status === s.id)])
  ) as Record<TaskStatus, Task[]>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onCreateTask}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva tarea
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Descargar plantilla
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {importing ? "Importando..." : "Importar Excel"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
        </div>
      </div>

      {importResult && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${importResult.errors.length === 0 ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          <p className="font-semibold mb-1">
            {importResult.imported} tarea{importResult.imported !== 1 ? "s" : ""} importada{importResult.imported !== 1 ? "s" : ""} correctamente
            {importResult.errors.length > 0 && ` · ${importResult.errors.length} con errores`}
          </p>
          {importResult.errors.length > 0 && (
            <ul className="list-disc list-inside space-y-0.5 text-xs mt-1">
              {importResult.errors.map((e) => (
                <li key={e.row}>Fila {e.row}: {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm rounded-2xl border border-slate-200 bg-white">
          No hay tareas. Crea una nueva o importa desde Excel.
        </div>
      )}

      {tasks.length > 0 && STATUS_SECTIONS.map((section) => {
        const sectionTasks = tasksBySection[section.id];
        const isCollapsed = section.collapsible && collapsed[section.id];
        return (
          <div key={section.id} className={`rounded-2xl border ${section.border} bg-white overflow-hidden`}>
            <div className={`flex items-center justify-between px-4 py-2.5 ${section.headerBg}`}>
              <button
                onClick={() => section.collapsible && setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))}
                disabled={!section.collapsible}
                className="flex items-center gap-2 disabled:cursor-default"
              >
                {section.collapsible && (
                  <svg
                    className={`w-3.5 h-3.5 ${section.headerText} transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
                <span className={`w-2 h-2 rounded-full ${section.dot}`} />
                <span className={`text-sm font-semibold ${section.headerText}`}>
                  {section.label} ({sectionTasks.length})
                </span>
              </button>
            </div>

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="w-1 px-0" />
                      <th onDoubleClick={() => handleSort("title")} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">Título<SortIcon col="title" /></th>
                      <th onDoubleClick={() => handleSort("frequency")} className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">Frecuencia<SortIcon col="frequency" /></th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                      <th onDoubleClick={() => handleSort("priority")} className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">Prioridad<SortIcon col="priority" /></th>
                      <th onDoubleClick={() => handleSort("startDate")} className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">Inicio<SortIcon col="startDate" /></th>
                      <th onDoubleClick={() => handleSort("endDate")} className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">Fin<SortIcon col="endDate" /></th>
                      <th onDoubleClick={() => handleSort("estimatedHours")} className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">H. Est.<SortIcon col="estimatedHours" /></th>
                      <th onDoubleClick={() => handleSort("realHours")} className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">H. Reales<SortIcon col="realHours" /></th>
                      <th onDoubleClick={() => handleSort("progress")} className="text-center px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700" title="Doble clic para ordenar">Avance<SortIcon col="progress" /></th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Coment.</th>
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence initial={false}>
                      {sectionTasks.length === 0 && (
                        <tr>
                          <td colSpan={12} className="text-center py-6 text-slate-400 text-xs">
                            Sin tareas en esta sección
                          </td>
                        </tr>
                      )}
                      {sectionTasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          currentUserId={currentUserId}
                          onFieldUpdate={onFieldUpdate}
                          onStatusChange={onStatusChange}
                          onEditTask={onEditTask}
                          onDeleteTask={onDeleteTask}
                          onCommentClick={setCommentTask}
                          onActivityClick={setActivityTask}
                        />
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

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
    </div>
  );
}
