"use client";

import { useState, useRef } from "react";
import type { Task, AssignableUser } from "./types";
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL");
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

type Props = {
  tasks: Task[];
  currentUserId: string;
  users: AssignableUser[];
  onFieldUpdate: (id: string, field: string, value: unknown) => Promise<void>;
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
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onRefresh,
  onCommentAdded,
}: Props) {
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [activityTask, setActivityTask] = useState<Task | null>(null);
  const [importing, setImporting] = useState(false);
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
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-slate-400 text-sm">
                  No hay tareas. Crea una nueva o importa desde Excel.
                </td>
              </tr>
            )}
            {tasks.map((task) => {
              const isOwner = task.assignedTo.id === currentUserId;
              return (
                <tr key={task.id} className="hover:bg-slate-50 transition-colors group">
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
                      onSave={(v) => onFieldUpdate(task.id, "status", v)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">{formatDate(task.startDate)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">{formatDate(task.endDate)}</td>
                  <td className="px-3 py-3 text-right text-slate-600">{task.estimatedHours}h</td>
                  <td className="px-3 py-3 text-right">
                    <InlineEdit
                      value={String(task.realHours)}
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
                          onClick={() => setActivityTask(task)}
                          className="text-slate-400 hover:text-violet-600 transition-colors"
                          title="Registro de actividades"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => setCommentTask(task)}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
