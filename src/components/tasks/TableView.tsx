"use client";

import { useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import type { Task, AssignableUser, TaskStatus } from "./types";
import { taskColorHex } from "./colors";
import { fireCelebrationConfetti } from "@/lib/confetti";
import { formatDate, isTaskOverdue } from "@/lib/utils";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";

type SortKey = "title" | "frequency" | "status" | "priority" | "startDate" | "endDate" | "estimatedHours" | "realHours";
import CommentPanel from "./CommentPanel";
import ActivityPanel from "./ActivityPanel";

const STATUS_LABELS: Record<Task["status"], string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En Progreso",
  COMPLETADA: "Completada",
};

const STATUS_STYLES: Record<Task["status"], string> = {
  PENDIENTE: "bg-warning/[.15] text-warning",
  EN_PROGRESO: "bg-primary-surface text-primary",
  COMPLETADA: "bg-success/[.13] text-success",
};

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  ALTA: "bg-danger/[.13] text-danger",
  MEDIA: "bg-warning/[.15] text-warning",
  BAJA: "bg-success/[.13] text-success",
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
}[] = [
  { id: "PENDIENTE", label: "Pendientes", headerBg: "bg-warning/[.15]", headerText: "text-warning", border: "border-border", dot: "bg-warning" },
  { id: "EN_PROGRESO", label: "En Progreso", headerBg: "bg-primary-surface", headerText: "text-primary", border: "border-border", dot: "bg-primary" },
  { id: "COMPLETADA", label: "Completadas", headerBg: "bg-success/[.13]", headerText: "text-success", border: "border-border", dot: "bg-success" },
];

function InlineEdit({
  value,
  type = "text",
  options,
  readOnly,
  min,
  step,
  onSave,
  renderDisplay,
}: {
  value: string;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  min?: string;
  step?: string;
  onSave: (v: string) => void;
  renderDisplay?: (value: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  function commit() {
    setEditing(false);
    if (local !== value) onSave(local);
  }

  if (readOnly) {
    return <span className="text-sm text-secondary cursor-not-allowed">{value}</span>;
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setLocal(value); setEditing(true); }}
        className="cursor-pointer"
        title="Clic para editar"
      >
        {renderDisplay ? renderDisplay(value) : (
          <span className="text-sm text-title hover:text-primary hover:underline underline-offset-2">
            {value || "—"}
          </span>
        )}
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
        className="text-sm text-title bg-surface border border-primary/40 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
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
      min={min}
      step={step}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="text-sm text-title bg-surface border border-primary/40 rounded-lg px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-primary"
    />
  );
}

function TaskRow({
  task,
  index,
  currentUserId,
  isSelected,
  onToggleSelect,
  onFieldUpdate,
  onStatusChange,
  onEditTask,
  onDeleteTask,
  onCommentClick,
  onActivityClick,
}: {
  task: Task;
  index: number;
  currentUserId: string;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
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
      className={`${isSelected ? "bg-primary-surface" : index % 2 === 1 ? "bg-black/[0.02] dark:bg-white/[0.02]" : "bg-surface"} hover:bg-primary-surface/40 transition-colors group`}
    >
      <td className="border border-border px-3 py-3.5 text-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(task.id)}
          className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
          aria-label={`Seleccionar tarea ${task.title}`}
        />
      </td>
      <td className="w-1 p-0" style={{ backgroundColor: hex ?? "transparent" }} />
      <td className="border border-border px-4 py-3.5 max-w-[200px]">
        <InlineEdit
          value={task.title}
          onSave={(v) => onFieldUpdate(task.id, "title", v)}
        />
        {task.assignedTo.name !== task.createdBy.name && (
          <p className="text-[10px] text-disabled mt-0.5">{task.assignedTo.name}</p>
        )}
      </td>
      <td className="border border-border px-4 py-3.5">
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
      <td className="border border-border px-4 py-3.5">
        <InlineEdit
          value={task.status}
          type="select"
          options={[
            { value: "PENDIENTE", label: "Pendiente" },
            { value: "EN_PROGRESO", label: "En Progreso" },
            { value: "COMPLETADA", label: "Completada" },
          ]}
          onSave={handleStatusSave}
          renderDisplay={(v) => (
            <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[v as TaskStatus]}`}>
              {STATUS_LABELS[v as TaskStatus]}
            </span>
          )}
        />
      </td>
      <td className="border border-border px-4 py-3.5">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}>
          {task.priority}
        </span>
      </td>
      <td className="border border-border px-4 py-3.5 whitespace-nowrap text-main">{formatDate(task.startDate)}</td>
      <td className={`border border-border px-4 py-3.5 whitespace-nowrap ${isTaskOverdue(task.endDate, task.status) ? "text-danger font-semibold" : "text-main"}`}>{formatDate(task.endDate)}</td>
      <td className="border border-border px-4 py-3.5 text-right text-main">{hoursToDisplay(task.estimatedHours)}h</td>
      <td className="border border-border px-4 py-3.5 text-right">
        <InlineEdit
          value={hoursToDisplay(task.realHours)}
          type="text"
          readOnly={!isOwner}
          onSave={(v) => {
            if (!validateDisplayHours(v)) { alert(INVALID_HOURS_MESSAGE); return; }
            onFieldUpdate(task.id, "realHours", displayToHours(v));
          }}
        />
        <span className="text-disabled ml-0.5 text-xs">h</span>
      </td>
      <td className="border border-border px-4 py-3.5 text-center">
        <div className="inline-flex items-center gap-2">
          {task.type === "SEGUIMIENTO" && (
            <button
              onClick={() => onActivityClick(task)}
              className="text-disabled hover:text-primary transition-colors"
              title="Registro de actividades"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onCommentClick(task)}
            className="relative inline-flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
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
      </td>
      <td className="border border-border px-4 py-3.5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEditTask(task)}
            className="p-1 text-disabled hover:text-primary rounded"
            title="Editar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDeleteTask(task.id)}
            className="p-1 text-disabled hover:text-danger rounded"
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
  onBulkDelete: (ids: string[]) => Promise<void>;
  onRefresh: () => void;
  onCommentAdded: (taskId: string) => void;
  onCommentsViewed: (taskId: string) => void;
};

function exportTasksToExcel(tasks: Task[]) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ["Título", "Descripción", "Estado", "Prioridad", "Frecuencia", "Fecha Inicio", "Fecha Fin", "Horas Estimadas", "Horas Reales", "Asignado a", "Email"],
    ...tasks.map((t) => [
      t.title,
      t.description ?? "",
      STATUS_LABELS[t.status],
      t.priority,
      FREQUENCY_LABELS[t.frequency],
      formatDate(t.startDate),
      formatDate(t.endDate),
      hoursToDisplay(t.estimatedHours),
      hoursToDisplay(t.realHours),
      t.assignedTo.name,
      t.assignedTo.email,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 30 }, { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Tareas");
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Tareas_seleccionadas_${dateStr}.xlsx`);
}

export default function TableView({
  tasks,
  currentUserId,
  users: _users,
  onFieldUpdate,
  onStatusChange,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onBulkDelete,
  onRefresh,
  onCommentAdded,
  onCommentsViewed,
}: Props) {
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [activityTask, setActivityTask] = useState<Task | null>(null);
  const [importing, setImporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ COMPLETADA: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllInSection(sectionTasks: Task[]) {
    const allSelected = sectionTasks.length > 0 && sectionTasks.every((t) => selected.has(t.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of sectionTasks) {
        if (allSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }

  const selectedTasks = useMemo(() => tasks.filter((t) => selected.has(t.id)), [tasks, selected]);

  function handleExportSelected() {
    if (selectedTasks.length === 0) return;
    exportTasksToExcel(selectedTasks);
    setSelected(new Set());
  }

  async function handleBulkDeleteClick() {
    if (selectedTasks.length === 0) return;
    const ownTasks = selectedTasks.filter((t) => t.createdBy.id === currentUserId);
    const othersCount = selectedTasks.length - ownTasks.length;

    if (ownTasks.length === 0) {
      alert("No puedes eliminar tareas de otros usuarios.");
      return;
    }

    const confirmMsg =
      `¿Eliminar ${ownTasks.length} tarea${ownTasks.length !== 1 ? "s" : ""} seleccionada${ownTasks.length !== 1 ? "s" : ""}?` +
      (othersCount > 0
        ? ` (${othersCount} tarea${othersCount !== 1 ? "s" : ""} de otro${othersCount !== 1 ? "s" : ""} usuario${othersCount !== 1 ? "s" : ""} se omitirá${othersCount !== 1 ? "n" : ""})`
        : "");
    if (!confirm(confirmMsg)) return;

    await onBulkDelete(ownTasks.map((t) => t.id));
    setSelected(new Set());

    if (othersCount > 0) {
      alert(
        `Se eliminaron ${ownTasks.length} tarea${ownTasks.length !== 1 ? "s" : ""}. ${othersCount} tarea${othersCount !== 1 ? "s" : ""} de otros usuarios no se eliminó${othersCount !== 1 ? "aron" : ""} porque solo el dueño puede eliminarlas.`
      );
    }
  }

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
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva tarea
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-main border border-border rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Descargar plantilla
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-main border border-border rounded-xl hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
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
        <div className={`rounded-xl px-4 py-3 text-sm border ${importResult.errors.length === 0 ? "bg-success/[.13] border-transparent text-success" : "bg-warning/[.15] border-transparent text-warning"}`}>
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
        <div className="text-center py-12 text-disabled text-sm rounded-2xl border border-border bg-surface">
          No hay tareas. Crea una nueva o importa desde Excel.
        </div>
      )}

      {tasks.length > 0 && STATUS_SECTIONS.map((section) => {
        const sectionTasks = tasksBySection[section.id];
        const isCollapsed = collapsed[section.id];
        return (
          <div key={section.id} className={`rounded-[14px] border ${section.border} bg-surface overflow-hidden shadow-[var(--shadow)]`}>
            <div className={`flex items-center justify-between px-4 py-2.5 ${section.headerBg}`}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))}
                className="flex items-center gap-2"
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
            </div>

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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-background">
                          <th className="border border-border px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={sectionTasks.length > 0 && sectionTasks.every((t) => selected.has(t.id))}
                              onChange={() => toggleSelectAllInSection(sectionTasks)}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                              aria-label={`Seleccionar todas las tareas de ${section.label}`}
                            />
                          </th>
                          <th className="w-1 px-0" />
                          <th onDoubleClick={() => handleSort("title")} className="border border-border text-left px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Título<SortIcon col="title" /></th>
                          <th onDoubleClick={() => handleSort("frequency")} className="border border-border text-left px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Frecuencia<SortIcon col="frequency" /></th>
                          <th className="border border-border text-left px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider">Estado</th>
                          <th onDoubleClick={() => handleSort("priority")} className="border border-border text-left px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Prioridad<SortIcon col="priority" /></th>
                          <th onDoubleClick={() => handleSort("startDate")} className="border border-border text-left px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Inicio<SortIcon col="startDate" /></th>
                          <th onDoubleClick={() => handleSort("endDate")} className="border border-border text-left px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">Fin<SortIcon col="endDate" /></th>
                          <th onDoubleClick={() => handleSort("estimatedHours")} className="border border-border text-right px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">H. Est.<SortIcon col="estimatedHours" /></th>
                          <th onDoubleClick={() => handleSort("realHours")} className="border border-border text-right px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider cursor-pointer select-none hover:text-title" title="Doble clic para ordenar">H. Reales<SortIcon col="realHours" /></th>
                          <th className="border border-border text-center px-4 py-3 text-[11px] font-semibold text-main uppercase tracking-wider">Coment.</th>
                          <th className="border border-border px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence initial={false}>
                          {sectionTasks.length === 0 && (
                            <tr>
                              <td colSpan={12} className="text-center py-6 text-disabled text-xs">
                                Sin tareas en esta sección
                              </td>
                            </tr>
                          )}
                          {sectionTasks.map((task, index) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              index={index}
                              currentUserId={currentUserId}
                              isSelected={selected.has(task.id)}
                              onToggleSelect={toggleSelect}
                              onFieldUpdate={onFieldUpdate}
                              onStatusChange={onStatusChange}
                              onEditTask={onEditTask}
                              onDeleteTask={onDeleteTask}
                              onCommentClick={(t) => { setCommentTask(t); onCommentsViewed(t.id); }}
                              onActivityClick={setActivityTask}
                            />
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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

      <AnimatePresence>
        {selectedTasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-title text-background rounded-2xl shadow-2xl px-5 py-3"
          >
            <span className="text-sm font-medium whitespace-nowrap">
              {selectedTasks.length} tarea{selectedTasks.length !== 1 ? "s" : ""} seleccionada{selectedTasks.length !== 1 ? "s" : ""}
            </span>
            <div className="w-px h-5 bg-background/20" />
            <button
              onClick={handleExportSelected}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-background/10 transition-colors whitespace-nowrap"
            >
              📥 Exportar seleccionadas
            </button>
            <button
              onClick={handleBulkDeleteClick}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg text-danger hover:bg-danger/20 transition-colors whitespace-nowrap"
            >
              🗑️ Eliminar seleccionadas
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-disabled hover:text-white ml-1 px-1"
              title="Cancelar selección"
              aria-label="Cancelar selección"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
