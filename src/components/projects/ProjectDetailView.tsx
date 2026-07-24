"use client";

import { useState } from "react";
import { BackLink } from "@/components/ui/BackLink";
import type { Role } from "@/generated/prisma/client";
import type { ProjectDetail, ProjectUserRef } from "./types";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_COLOR, PROJECT_PRIORITY_LABEL } from "./types";
import ProjectSummaryTab from "./ProjectSummaryTab";
import ProjectPhasesTab from "./ProjectPhasesTab";
import ProjectParticipantsTab from "./ProjectParticipantsTab";
import ProjectActivitiesTab from "./ProjectActivitiesTab";
import ProjectCommentsTab from "./ProjectCommentsTab";
import ProjectDocumentsTab from "./ProjectDocumentsTab";
import ProjectHistoryTab from "./ProjectHistoryTab";

type TabKey = "resumen" | "fases" | "participantes" | "actividades" | "comentarios" | "documentos" | "historial";

const TABS: { key: TabKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "fases", label: "Fases" },
  { key: "participantes", label: "Participantes" },
  { key: "actividades", label: "Actividades" },
  { key: "comentarios", label: "Comentarios" },
  { key: "documentos", label: "Documentos" },
  { key: "historial", label: "Historial" },
];

type Props = {
  initialProject: ProjectDetail;
  currentUserId: string;
  currentUserRole: Role;
  canManage: boolean;
  canDelete: boolean;
  candidateUsers: ProjectUserRef[];
};

export default function ProjectDetailView({ initialProject, currentUserId, currentUserRole, canManage, canDelete, candidateUsers }: Props) {
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState<TabKey>("resumen");

  const participantUserIds = project.participants.map((p) => p.userId);
  const isParticipant = canManage || participantUserIds.includes(currentUserId);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <BackLink href="/projects" label="Proyectos" />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-title">{project.name}</h1>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${PROJECT_STATUS_COLOR[project.status]}`}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </div>
          {project.description && <p className="text-sm text-secondary mt-1 max-w-2xl">{project.description}</p>}
        </div>
        <div className="text-right text-xs text-secondary">
          <p>Responsable: <span className="font-semibold text-title">{project.responsible.name}</span></p>
          <p>Prioridad: <span className="font-semibold text-title">{PROJECT_PRIORITY_LABEL[project.priority]}</span></p>
        </div>
      </div>

      <div className="border-b border-border flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-secondary hover:text-title"
            }`}
          >
            {t.label}
            {t.key === "participantes" && ` (${project.participants.length})`}
            {t.key === "fases" && ` (${project.phases.length})`}
            {t.key === "comentarios" && project._count.comments > 0 && ` (${project._count.comments})`}
            {t.key === "documentos" && project._count.documents > 0 && ` (${project._count.documents})`}
            {t.key === "actividades" && project._count.activities > 0 && ` (${project._count.activities})`}
          </button>
        ))}
      </div>

      <div>
        {tab === "resumen" && (
          <ProjectSummaryTab project={project} canManage={canManage} canDelete={canDelete} onUpdated={setProject} />
        )}
        {tab === "fases" && (
          <ProjectPhasesTab
            projectId={project.id}
            phases={project.phases}
            canManage={canManage}
            candidateUsers={candidateUsers.length > 0 ? candidateUsers : project.participants.map((p) => p.user)}
            onPhasesChanged={(phases) => setProject((prev) => ({ ...prev, phases }))}
          />
        )}
        {tab === "participantes" && (
          <ProjectParticipantsTab
            projectId={project.id}
            participants={project.participants}
            responsibleId={project.responsible.id}
            canManage={canManage}
            candidateUsers={candidateUsers}
            onParticipantsChanged={(participants) => setProject((prev) => ({ ...prev, participants }))}
          />
        )}
        {tab === "actividades" && (
          <ProjectActivitiesTab
            projectId={project.id}
            phases={project.phases}
            targetTimeHours={project.targetTimeHours}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            canRegister={isParticipant}
          />
        )}
        {tab === "comentarios" && (
          <ProjectCommentsTab projectId={project.id} canComment={isParticipant} />
        )}
        {tab === "documentos" && (
          <ProjectDocumentsTab projectId={project.id} canUpload={isParticipant} />
        )}
        {tab === "historial" && <ProjectHistoryTab projectId={project.id} />}
      </div>
    </div>
  );
}
