"use client";

import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Task } from "./types";
import { taskColorHex } from "./colors";
import { formatDate } from "@/lib/utils";
import { hoursToDisplay } from "@/lib/timeFormat";
import { getOfficialTargetTime, isTargetTimeValidated } from "@/lib/targetTime";
import CorrectArchivedTaskModal from "./CorrectArchivedTaskModal";
import { Button } from "@/components/ui/Button";
import { StatusChip, PriorityChip } from "@/components/ui/Chip";
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from "@/lib/chipConfig";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonText, SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Archive } from "lucide-react";

type RepositoryMonth = { year: number; month: number; totalTasks: number; completedTasks: number; totalHours: number };

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
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (selected) {
    const pct = selected.totalTasks > 0 ? Math.round((selected.completedTasks / selected.totalTasks) * 100) : 0;
    return (
      <div className="flex flex-col gap-4">
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => { setSelected(null); setTasks(null); }}
          className="w-fit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver al repositorio
        </Button>

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

        {loadingTasks && (
          <div className="rounded-2xl border border-border bg-surface divide-y divide-border">
            <SkeletonRow columns={9} />
            <SkeletonRow columns={9} />
            <SkeletonRow columns={9} />
          </div>
        )}

        {!loadingTasks && tasks && (
          <div className="rounded-2xl border border-border bg-surface">
            <Table>
              <TableHead>
                <tr className="border-b border-border">
                  <th className="w-1 px-0" />
                  <Th>Título</Th>
                  <Th>Responsable</Th>
                  <Th>Frecuencia</Th>
                  <Th>Estado</Th>
                  <Th>Prioridad</Th>
                  <Th>Fin</Th>
                  <Th className="text-right">T. Objetivo</Th>
                  <Th className="text-right">H. Reales</Th>
                  <Th className="text-center">Avance</Th>
                  {isAdmin && <Th className="text-right">Acciones</Th>}
                </tr>
              </TableHead>
              <TableBody>
                {tasks.length === 0 && (
                  <TableRow>
                    <Td colSpan={isAdmin ? 10 : 9} className="p-0">
                      <EmptyState
                        title="Sin tareas archivadas"
                        description="No tienes tareas archivadas visibles en este mes."
                      />
                    </Td>
                  </TableRow>
                )}
                {tasks.map((task) => {
                  const hex = taskColorHex(task.color);
                  return (
                    <TableRow key={task.id}>
                      <td className="w-1 p-0" style={{ backgroundColor: hex ?? "transparent" }} />
                      <Td className="max-w-[200px] text-title">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{task.title}</span>
                          {task.corrected && (
                            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning/[.15] text-warning" title="Editada después del cierre mensual">
                              ✏️ Corregida
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>{task.assignedTo.name}</Td>
                      <Td>{FREQUENCY_LABELS[task.frequency]}</Td>
                      <Td>
                        <StatusChip value={task.status} config={TASK_STATUS_CONFIG} />
                      </Td>
                      <Td>
                        <PriorityChip value={task.priority} config={TASK_PRIORITY_CONFIG} />
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(task.endDate)}</Td>
                      <Td className="text-right">
                        {hoursToDisplay(getOfficialTargetTime(task))}h
                        {isTargetTimeValidated(task) && (
                          <span className="ml-1 text-success text-[10px]" title="Tiempo objetivo validado">✓</span>
                        )}
                      </Td>
                      <Td className="text-right">{hoursToDisplay(task.realHours)}h</Td>
                      <Td>
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${task.progress}%` }} />
                          </div>
                          <span className="text-[10px] text-secondary w-7 text-right">{task.progress}%</span>
                        </div>
                      </Td>
                      {isAdmin && (
                        <Td className="text-right">
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() => setCorrectingTask(task)}
                            className="whitespace-nowrap"
                          >
                            ✏️ Corregir
                          </Button>
                        </Td>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
      <div className="rounded-2xl border border-border bg-surface">
        <EmptyState
          icon={Archive}
          title="Sin meses cerrados"
          description="Todavía no hay meses cerrados en el repositorio."
        />
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
