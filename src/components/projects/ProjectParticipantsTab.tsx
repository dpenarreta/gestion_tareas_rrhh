"use client";

import { useState } from "react";
import type { ProjectParticipant, ProjectUserRef } from "./types";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

type Props = {
  projectId: string;
  participants: ProjectParticipant[];
  responsibleId: string;
  canManage: boolean;
  candidateUsers: ProjectUserRef[];
  onParticipantsChanged: (participants: ProjectParticipant[]) => void;
};

export default function ProjectParticipantsTab({
  projectId,
  participants,
  responsibleId,
  canManage,
  candidateUsers,
  onParticipantsChanged,
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const availableCandidates = candidateUsers.filter((u) => !participants.some((p) => p.userId === u.id));

  async function addParticipant() {
    if (!selectedUserId || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      if (res.ok) {
        const created = await res.json();
        onParticipantsChanged([...participants, created]);
        setSelectedUserId("");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al agregar participante");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function removeParticipant(participantId: string) {
    setRemovingId(participantId);
    try {
      const res = await fetch(`/api/projects/${projectId}/participants/${participantId}`, { method: "DELETE" });
      if (res.ok) {
        onParticipantsChanged(participants.filter((p) => p.id !== participantId));
      }
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && availableCandidates.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Agregar participante</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              <option value="">Selecciona un usuario…</option>
              {availableCandidates.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={addParticipant}
            disabled={!selectedUserId || submitting}
            className="bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40"
          >
            Agregar
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {participants.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-title">
                {p.user.name}
                {p.userId === responsibleId && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary-surface text-primary">
                    Responsable
                  </span>
                )}
              </p>
              <p className="text-xs text-secondary">
                {p.user.role ? ROLE_LABEL[p.user.role as Role] ?? p.user.role : ""} · agregado por {p.addedBy.name}
              </p>
            </div>
            {canManage && p.userId !== responsibleId && (
              <button
                onClick={() => removeParticipant(p.id)}
                disabled={removingId === p.id}
                className="text-xs text-danger hover:underline disabled:opacity-40"
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
