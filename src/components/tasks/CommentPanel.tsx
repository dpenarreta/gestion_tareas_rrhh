"use client";

import { useState, useEffect, useRef } from "react";
import type { Task, TaskComment } from "./types";

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

type Props = {
  task: Task;
  currentUserId: string;
  onClose: () => void;
  onCommentAdded: () => void;
};

export default function CommentPanel({ task, currentUserId: _cu, onClose, onCommentAdded }: Props) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/tasks/${task.id}/comments`)
      .then((r) => r.json())
      .then((data) => setComments(data))
      .finally(() => setLoading(false));
  }, [task.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  async function submit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const comment = await res.json();
        setComments((prev) => [...prev, comment]);
        setText("");
        onCommentAdded();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-80 bg-white border-l border-slate-200 shadow-xl z-50 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 text-sm truncate">{task.title}</h3>
            <p className="text-xs text-slate-500">Comentarios</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="text-center text-slate-400 text-sm py-8">Cargando...</div>
          )}
          {!loading && comments.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Sin comentarios aún
            </div>
          )}
          {comments.map((c) => (
            <div key={c.id} className="bg-slate-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-800">{c.author.name}</span>
                <span className="text-[10px] text-slate-400">{formatRelative(c.createdAt)}</span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{c.text}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-slate-200">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
            }}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
            rows={3}
            placeholder="Escribe un comentario... (Ctrl+Enter para enviar)"
          />
          <button
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="mt-2 w-full bg-indigo-600 text-white rounded-xl py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Enviando..." : "Comentar"}
          </button>
        </div>
      </aside>
    </>
  );
}
