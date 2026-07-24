"use client";

import type { Task } from "./types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GanttChart as GanttChartIcon } from "lucide-react";

const STATUS_BAR: Record<Task["status"], string> = {
  PENDIENTE: "bg-disabled",
  EN_PROGRESO: "bg-primary/60",
  COMPLETADA: "bg-success/60",
};

const STATUS_PROGRESS: Record<Task["status"], string> = {
  PENDIENTE: "bg-secondary",
  EN_PROGRESO: "bg-primary",
  COMPLETADA: "bg-success",
};

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("es-CL", { month: "short", year: "2-digit" });
}

function getWeeksInRange(start: Date, end: Date) {
  const weeks: Date[] = [];
  const cur = new Date(start);
  cur.setDate(cur.getDate() - cur.getDay());
  while (cur <= end) {
    weeks.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

type Props = { tasks: Task[]; onCreateTask: () => void };

export default function GanttView({ tasks, onCreateTask }: Props) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={GanttChartIcon}
        title="No hay tareas para mostrar"
        action={
          <Button onClick={onCreateTask}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva tarea
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={onCreateTask}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva tarea
        </Button>
      </div>
      <GanttChart tasks={tasks} />
    </div>
  );
}

function GanttChart({ tasks }: { tasks: Task[] }) {
  const allDates = tasks.flatMap((t) => [new Date(t.startDate), new Date(t.endDate)]);
  const rangeStart = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const rangeEnd = new Date(Math.max(...allDates.map((d) => d.getTime())));

  rangeStart.setDate(rangeStart.getDate() - 3);
  rangeEnd.setDate(rangeEnd.getDate() + 3);

  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 7);
  const pxPerDay = 28;
  const totalWidth = totalDays * pxPerDay;
  const labelWidth = 180;

  const weeks = getWeeksInRange(rangeStart, rangeEnd);

  const today = new Date();
  const todayOffset = daysBetween(rangeStart, today);

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <div style={{ minWidth: labelWidth + totalWidth }}>
        {/* Header: months */}
        <div className="flex border-b border-border bg-background">
          <div style={{ width: labelWidth }} className="shrink-0 px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider border-r border-border">
            Tarea
          </div>
          <div className="flex-1 relative" style={{ width: totalWidth }}>
            {weeks.map((week, i) => {
              const offset = daysBetween(rangeStart, week) * pxPerDay;
              const isMonthStart = week.getDate() <= 7;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 flex flex-col justify-end pb-1"
                  style={{ left: offset, width: 7 * pxPerDay }}
                >
                  {isMonthStart && (
                    <span className="text-[10px] text-secondary font-medium px-1 absolute top-1 left-0">
                      {formatMonthLabel(week)}
                    </span>
                  )}
                  <span className="text-[9px] text-disabled px-1">
                    {week.getDate()}/{week.getMonth() + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Grid lines row */}
        <div className="flex border-b border-border">
          <div style={{ width: labelWidth }} className="shrink-0 border-r border-border" />
          <div className="relative flex-1" style={{ width: totalWidth, height: 0 }}>
            {weeks.map((week, i) => {
              const offset = daysBetween(rangeStart, week) * pxPerDay;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-border"
                  style={{ left: offset, height: tasks.length * 48 + 48 }}
                />
              );
            })}
            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div
                className="absolute top-0 w-0.5 bg-danger z-10"
                style={{ left: todayOffset * pxPerDay, height: tasks.length * 48 + 48 }}
                title="Hoy"
              />
            )}
          </div>
        </div>

        {/* Task rows */}
        {tasks.map((task) => {
          const taskStart = new Date(task.startDate);
          const taskEnd = new Date(task.endDate);
          const offsetDays = daysBetween(rangeStart, taskStart);
          const durationDays = Math.max(daysBetween(taskStart, taskEnd), 1);
          const barLeft = offsetDays * pxPerDay;
          const barWidth = durationDays * pxPerDay;

          return (
            <div key={task.id} className="flex border-b border-border hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ height: 48 }}>
              <div
                style={{ width: labelWidth }}
                className="shrink-0 flex items-center px-4 border-r border-border"
              >
                <div className="min-w-0" title={`${task.assignedTo.name} · ${formatDate(task.startDate)} → ${formatDate(task.endDate)}`}>
                  <p className="text-xs font-medium text-title truncate">{task.title}</p>
                  <p className="text-[10px] text-disabled truncate">
                    {task.assignedTo.name} · {formatDate(task.startDate)} → {formatDate(task.endDate)}
                  </p>
                </div>
              </div>
              <div className="relative flex-1" style={{ width: totalWidth }}>
                <div
                  className={`absolute top-1/2 -translate-y-1/2 rounded-lg overflow-hidden ${STATUS_BAR[task.status]}`}
                  style={{ left: barLeft, width: Math.max(barWidth, 20), height: 24 }}
                  title={`${task.title}: ${formatDate(task.startDate)} → ${formatDate(task.endDate)} (${task.progress}%)`}
                >
                  {task.progress > 0 && (
                    <div
                      className={`h-full ${STATUS_PROGRESS[task.status]} transition-all`}
                      style={{ width: `${task.progress}%` }}
                    />
                  )}
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] text-white font-medium truncate">
                    {task.title}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
