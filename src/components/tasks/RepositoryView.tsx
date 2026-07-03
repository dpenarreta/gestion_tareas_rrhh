"use client";

import { useEffect, useMemo, useState } from "react";
import type { Task } from "./types";
import { taskColorHex } from "./colors";
import { formatDate } from "@/lib/utils";

type RepositoryMonth = { year: number; month: number; totalTasks: number; completedTasks: number; totalHours: number };

const STATUS_STYLES: Record<Task["status"], string> = {
  PENDIENTE: "bg-slate-100 text-slate-700",
  EN_PROGRESO: "bg-blue-100 text-blue-700",
  COMPLETADA: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<Task["status"], string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En Progreso",
  COMPLETADA: "Completada",
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

function monthLabel(year: number, month: number) {
  const label = new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtH(n: number) {
  return Math.round(n * 100) / 100;
}

export default function RepositoryView() {
  const [months, setMonths] = useState<RepositoryMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RepositoryMonth | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

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
    return <div className="text-sm text-slate-400 py-16 text-center">Cargando repositorio…</div>;
  }

  if (selected) {
    const pct = selected.totalTasks > 0 ? Math.round((selected.completedTasks / selected.totalTasks) * 100) : 0;
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => { setSelected(null); setTasks(null); }}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 transition-colors w-fit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver al repositorio
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-lg font-bold text-slate-900">{monthLabel(selected.year, selected.month)} {selected.year}</p>
            <p className="text-xs text-slate-400">Archivo de solo lectura</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Total tareas</p>
              <p className="font-semibold text-slate-800">{selected.totalTasks}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">% Completadas</p>
              <p className="font-semibold text-slate-800">{pct}%</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Horas totales</p>
              <p className="font-semibold text-slate-800">{fmtH(selected.totalHours)}h</p>
            </div>
          </div>
        </div>

        {loadingTasks && <div className="text-sm text-slate-400 py-8 text-center">Cargando tareas…</div>}

        {!loadingTasks && tasks && (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="w-1 px-0" />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Título</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Responsable</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Frecuencia</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Prioridad</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fin</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">H. Est.</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">H. Reales</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Avance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-slate-400 text-sm">
                      No tienes tareas archivadas visibles en este mes.
                    </td>
                  </tr>
                )}
                {tasks.map((task) => {
                  const hex = taskColorHex(task.color);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                      <td className="w-1 p-0" style={{ backgroundColor: hex ?? "transparent" }} />
                      <td className="px-4 py-3 max-w-[200px] text-slate-800">{task.title}</td>
                      <td className="px-3 py-3 text-slate-600">{task.assignedTo.name}</td>
                      <td className="px-3 py-3 text-slate-600">{FREQUENCY_LABELS[task.frequency]}</td>
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
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">{formatDate(task.endDate)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmtH(task.estimatedHours)}h</td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmtH(task.realHours)}h</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${task.progress}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-500 w-7 text-right">{task.progress}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-sm rounded-2xl border border-slate-200 bg-white">
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
          <h3 className="text-sm font-bold text-slate-800 mb-2.5">{year}</h3>
          <div className="flex flex-wrap gap-2.5">
            {list.map((m) => {
              const pct = m.totalTasks > 0 ? Math.round((m.completedTasks / m.totalTasks) * 100) : 0;
              return (
                <button
                  key={m.month}
                  onClick={() => openMonth(m)}
                  className="flex flex-col items-start gap-1 px-4 py-3 rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors text-left min-w-[160px]"
                >
                  <span className="text-sm font-semibold text-slate-800">{monthLabel(m.year, m.month)}</span>
                  <span className="text-xs text-slate-500">{m.totalTasks} tareas · {pct}% completadas</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
