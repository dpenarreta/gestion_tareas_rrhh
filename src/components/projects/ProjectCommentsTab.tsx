"use client";

import { useEffect, useState } from "react";
import type { ProjectComment } from "./types";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import { useToast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/utils";

export default function ProjectCommentsTab({ projectId, canComment }: { projectId: string; canComment: boolean }) {
  const { showToast } = useToast();
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setComments(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function submit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (res.ok) {
        const comment = await res.json();
        setComments((prev) => [...prev, comment]);
        setText("");
      } else {
        // Sprint C §7: antes fallaba en silencio (el comentario se perdía sin
        // avisar). "Reintentar" repite la misma llamada — recuperación segura.
        showToast("No se pudo publicar el comentario.", "error", { label: "Reintentar", onClick: submit });
      }
    } catch {
      showToast("Error de conexión.", "error", { label: "Reintentar", onClick: submit });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      {loading && <div className="text-center text-disabled text-sm py-8">Cargando…</div>}
      {!loading && comments.length === 0 && (
        <div className="text-center text-disabled text-sm py-12 bg-surface border border-border rounded-2xl">Sin comentarios aún</div>
      )}
      <div className="space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="bg-surface border border-border rounded-2xl p-3.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-semibold text-title">{c.author.name}</span>
              <span className="text-[10px] text-disabled">{ROLE_LABEL[c.author.role as Role] ?? c.author.role}</span>
              <span className="text-[10px] text-disabled ml-auto">{formatRelative(c.createdAt)}</span>
            </div>
            <p className="text-sm text-main mt-1 whitespace-pre-wrap">{c.text}</p>
          </div>
        ))}
      </div>

      {canComment && (
        <div className="pt-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
            }}
            rows={3}
            placeholder="Escribe un comentario… (Ctrl+Enter para enviar)"
            className="w-full border border-border rounded-xl p-3 text-sm text-title bg-surface placeholder:text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
          <button
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="mt-2 bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Enviando…" : "Comentar"}
          </button>
        </div>
      )}
    </div>
  );
}
