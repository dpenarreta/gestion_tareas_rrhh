"use client";

import Link from "next/link";
import type { ProjectListItem } from "./types";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_COLOR, PROJECT_PRIORITY_LABEL } from "./types";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ProjectCard({ project }: { project: ProjectListItem }) {
  const pct = project.targetTimeHours > 0 ? Math.min(100, Math.round((project.realHours / project.targetTimeHours) * 100)) : 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block bg-surface border border-border rounded-2xl p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-title text-sm leading-snug line-clamp-2">{project.name}</h3>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${PROJECT_STATUS_COLOR[project.status]}`}>
          {PROJECT_STATUS_LABEL[project.status]}
        </span>
      </div>

      {project.description && (
        <p className="text-xs text-secondary line-clamp-2 mb-3">{project.description}</p>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {project.area && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface2 text-secondary">{project.area}</span>
        )}
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface2 text-secondary">
          Prioridad {PROJECT_PRIORITY_LABEL[project.priority]}
        </span>
        {project.tags.slice(0, 2).map((t) => (
          <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary-surface text-primary">
            #{t}
          </span>
        ))}
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between text-[11px] text-secondary mb-1">
          <span>Tiempo objetivo</span>
          <span className="font-semibold text-title">
            {project.realHours}h / {project.targetTimeHours}h
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-disabled">
        <span>Responsable: <span className="text-secondary font-medium">{project.responsible.name}</span></span>
        <span>Meta: {formatDate(project.targetDate)}</span>
      </div>

      <div className="flex items-center gap-3 mt-2 text-[11px] text-disabled">
        <span>{project._count.participants} participantes</span>
        <span>{project._count.phases} fases</span>
      </div>
    </Link>
  );
}
