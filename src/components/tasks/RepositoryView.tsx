"use client";

import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Task } from "./types";
import { taskColorHex } from "./colors";
import { formatDate } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";
import CorrectArchivedTaskModal from "./CorrectArchivedTaskModal";

type RepositoryMonth = { year: number; month: number; totalTasks: number; completedTasks: number; totalHours: number };

const STATUS_STYLES: Record<Task["status"], string> = {
  PENDIENTE: "bg-surface2 text-secondary",
  EN_PROGRESO: "bg-primary-surface text-primary",
  COMPLETADA: "bg-success/[.13] text-success",
};

const STATUS_LABELS: Record<Task["status"], string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En Progreso",
  COMPLETADA: "Completada",
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

function monthLabel(year: number, month: number) {
  const label = new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Props = {
  currentUserRole: Role;
};

export default function RepositoryView({ currentUserRole }: Props) {
  const [months, setMonths] = useState<RepositoryMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RepositoryMonth | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [correctingTask, setCorrectingTask] = useState<Task | null>(null);
  const isAdmin = currentUserRole === "ADMINISTRADOR";

  function handleCorrected(updated: Task) {
    setTasks((prev) => prev && prev.map((t) => (t.id === updated.id ? updated : t)));
    setCorrectingTask(null);
  }

  useEffect(() => {
    fetch("/api/repository")
      .then((r) => r.json())
      .then((data: RepositoryMonth[]) => setMonths(data))
      .finally(() => setLoading(false));
  }, []);

  async function openMonth(m: RepositoryMonth) {
    setSelected(m);
    setLoadingTasks(true);
    setTasks(null);
    const res = await fetch(`/api/repository/${m.year}/${m.month}`);
    const data = await res.json();
    setTasks(res.ok ? data : []);
    setLoadingTasks(false);
  }

  const byYear = useMemo(() => {
    const map = new Map<number, RepositoryMonth[]>();
    for (const m of months) {
      const list = map.get(m.year) ?? [];
      list.push(m);
      map.set(m.year, list);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => [year, list.sort((a, b) => b.month - a.month)] as const);
  }, [months]);

  if (loading) {
    return <div className="text-sm text-disabled py-16 text-center">Cargando repositorio…</div>;
  }

  if (selected) {
    const pct = selected.totalTasks > 0 ? Math.round((selected.completedTasks / selected.totalTasks) * 100) : 0;
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => { setSelected(null); setTasks(null); }}
          className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors w-fit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver al repositorio
        </button>

        <div className="rounded-2xl border border-border bg-surface p-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-lg font-bold text-title">{monthLabel(selected.year, selected.month)} {selected.year}</p>
            <p className="text-xs text-disabled">Archivo de solo lectura</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-disabled text-xs">Total tareas</p>
              <p className="font-semibold text-title">{selected.totalTasks}</p>
            </div>
            <div>
              <p className="text-disabled text-xs">% Completadas</p>
              <p className="font-semibold text-title">{pct}%</p>
            </div>
            <div>
              <p className="text-disabled text-xs">Horas totales</p>
              <p className="font-semibold text-title">{hoursToDisplay(selected.totalHours)}h</p>
            </div>
          </div>
        </div>

        {loadingTasks && <div className="text-sm text-disabled py-8 text-center">Cargando tareas…</div>}

        {!loadingTasks && tasks && (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="w-1 px-0" />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Título</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Responsable</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Frecuencia</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Estado</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Prioridad</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Fin</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">H. Est.</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">H. Reales</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Avance</th>
                  {isAdmin && <th className="text-right px-3 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="text-center py-10 text-disabled text-sm">
                      No tienes tareas archivadas visibles en este mes.
                    </td>
                  </tr>
                )}
                {tasks.map((task) => {
                  const hex = taskColorHex(task.color);
                  return (
                    <tr key={task.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                      <td className="w-1 p-0" style={{ backgroundColor: hex ?? "transparent" }} />
                      <td className="px-4 py-3 max-w-[200px] text-title">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{task.title}</span>
                          {task.corrected && (
                            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning/[.15] text-warning" title="Editada después del cierre mensual">
                              ✏️ Corregida
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-main">{task.assignedTo.name}</td>
                      <td className="px-3 py-3 text-main">{FREQUENCY_LABELS[task.frequency]}</td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLES[task.status]}`}>
                          {STATUS_LABELS[task.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}>
                          {task.priority}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-main">{formatDate(task.endDate)}</td>
                      <td className="px-3 py-3 text-right text-main">{hoursToDisplay(task.estimatedHours)}h</td>
                      <td className="px-3 py-3 text-right text-main">{hoursToDisplay(task.realHours)}h</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${task.progress}%` }} />
                          </div>
                          <span className="text-[10px] text-secondary w-7 text-right">{task.progress}%</span>
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => setCorrectingTask(task)}
                            className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors whitespace-nowrap"
                          >
                            ✏️ Corregir
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {correctingTask && (
          <CorrectArchivedTaskModal
            task={correctingTask}
            onClose={() => setCorrectingTask(null)}
            onSaved={handleCorrected}
          />
        )}
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-disabled text-sm rounded-2xl border border-border bg-surface">
        <svg className="w-8 h-8 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 01-2-2V4a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        Todavía no hay meses cerrados en el repositorio.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {byYear.map(([year, list]) => (
        <div key={year}>
          <h3 className="text-sm font-bold text-title mb-2.5">{year}</h3>
          <div className="flex flex-wrap gap-2.5">
            {list.map((m) => {
              const pct = m.totalTasks > 0 ? Math.round((m.completedTasks / m.totalTasks) * 100) : 0;
              return (
                <button
                  key={m.month}
                  onClick={() => openMonth(m)}
                  className="flex flex-col items-start gap-1 px-4 py-3 rounded-2xl border border-border bg-surface hover:border-primary/40 hover:bg-primary-surface/50 transition-colors text-left min-w-[160px]"
                >
                  <span className="text-sm font-semibold text-title">{monthLabel(m.year, m.month)}</span>
                  <span className="text-xs text-secondary">{m.totalTasks} tareas · {pct}% completadas</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
