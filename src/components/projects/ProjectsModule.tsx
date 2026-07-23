"use client";

import { useState } from "react";
import type { ProjectListItem, ProjectUserRef } from "./types";
import ProjectCard from "./ProjectCard";
import CreateProjectModal from "./CreateProjectModal";

type Props = {
  initialProjects: ProjectListItem[];
  currentUserId: string;
  currentUserName: string;
  candidateUsers: ProjectUserRef[];
  canCreate: boolean;
};

export default function ProjectsModule({ initialProjects, currentUserId, candidateUsers, canCreate }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-title">Proyectos</h1>
          <p className="text-sm text-secondary">Iniciativas transversales con fases, participantes y seguimiento propio.</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            + Nuevo proyecto
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center text-disabled text-sm py-16 bg-surface border border-border rounded-2xl">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          Sin proyectos todavía
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          currentUserId={currentUserId}
          candidateUsers={candidateUsers}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setProjects((prev) => [created, ...prev]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
