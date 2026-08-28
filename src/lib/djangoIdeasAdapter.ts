import "server-only";
import type { IdeaImpact, IdeaStatus } from "@/components/ideas/types";

/**
 * Adaptador entre la forma de Mejora Continua de Django (Fase 11 del
 * backend, cutover de stack Fase 43, ver docs/AUDIT_LOG.md § 2026-08-21) y
 * `src/components/ideas/*` (sin cambios). Mismo patrón que
 * `djangoMeetingsAdapter.ts`/`djangoProjectsAdapter.ts`.
 */

type DjangoIdeaUserRef = {
  id: number;
  username: string;
  first_name: string;
  email: string;
  roles: { id: number; name: string }[];
};

function toUserRef(user: DjangoIdeaUserRef) {
  return { id: String(user.id), name: user.first_name || user.username, role: user.roles[0]?.name ?? "" };
}

export type DjangoIdeaHistoryEntry = {
  id: number;
  from_status: string;
  to_status: string;
  comment: string | null;
  created_at: string;
  changer: DjangoIdeaUserRef;
};

function mapHistoryEntry(entry: DjangoIdeaHistoryEntry) {
  return {
    id: String(entry.id),
    fromStatus: entry.from_status as IdeaStatus,
    toStatus: entry.to_status as IdeaStatus,
    comment: entry.comment,
    createdAt: entry.created_at,
    changer: toUserRef(entry.changer),
  };
}

export type DjangoIdeaListItem = {
  id: number;
  title: string;
  description: string;
  impact: string;
  status: string;
  progress: number;
  attachment_name: string | null;
  attachment_mime: string | null;
  created_at: string;
  updated_at: string;
  author: DjangoIdeaUserRef;
  latest_rejection_comment: string | null;
  vote_count: number;
  voted_by_me: boolean;
};

export function mapDjangoIdeaListItemToNexoShape(idea: DjangoIdeaListItem) {
  return {
    id: String(idea.id),
    title: idea.title,
    description: idea.description,
    impact: idea.impact as IdeaImpact,
    status: idea.status as IdeaStatus,
    progress: idea.progress,
    attachmentUrl: idea.attachment_name,
    createdAt: idea.created_at,
    updatedAt: idea.updated_at,
    author: toUserRef(idea.author),
    latestRejectionComment: idea.latest_rejection_comment,
    voteCount: idea.vote_count,
    votedByMe: idea.voted_by_me,
  };
}

export type DjangoIdea = {
  id: number;
  title: string;
  description: string;
  impact: string;
  status: string;
  progress: number;
  attachment_name: string | null;
  attachment_mime: string | null;
  created_at: string;
  updated_at: string;
  author: DjangoIdeaUserRef;
  vote_count: number;
  voted_by_me: boolean;
};

export function mapDjangoIdeaToNexoShape(idea: DjangoIdea) {
  return {
    id: String(idea.id),
    title: idea.title,
    description: idea.description,
    impact: idea.impact as IdeaImpact,
    status: idea.status as IdeaStatus,
    progress: idea.progress,
    attachmentUrl: idea.attachment_name,
    createdAt: idea.created_at,
    updatedAt: idea.updated_at,
    author: toUserRef(idea.author),
    voteCount: idea.vote_count,
    votedByMe: idea.voted_by_me,
  };
}

export type DjangoIdeaDetail = DjangoIdea & {
  attachment_data: string | null;
  history: DjangoIdeaHistoryEntry[];
};

export function mapDjangoIdeaDetailToNexoShape(idea: DjangoIdeaDetail) {
  return {
    ...mapDjangoIdeaToNexoShape(idea),
    attachmentData: idea.attachment_data,
    history: idea.history.map(mapHistoryEntry),
  };
}

export function mapDjangoIdeaHistoryToNexoShape(history: DjangoIdeaHistoryEntry[]) {
  return history.map(mapHistoryEntry);
}

// Las vistas de `apps.ideas` construyen su `Response` de error a mano
// (contrato plano `{"error": "mensaje"}`), igual que
// `apps.meetings`/`apps.configuration` — se usa
// `extractDjangoFlatErrorMessage` (`@/lib/djangoSession`) para leerlo, sin
// duplicar el helper acá.
