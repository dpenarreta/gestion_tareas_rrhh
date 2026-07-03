"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import { canManageUsers } from "@/lib/roles";

type Mode = "general" | "tasks" | "hr";

type Source = { title: string; fileName: string; pageNumber: number };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

type KnowledgeDoc = {
  id: string;
  title: string;
  fileName: string;
  createdAt: string;
  uploadedBy?: { name: string };
  _count: { chunks: number };
};

const MODE_CONFIG: Record<Mode, { label: string; description: string; color: string }> = {
  general: {
    label: "General",
    description: "Consultas generales sobre Nexo y RRHH",
    color: "indigo",
  },
  tasks: {
    label: "Mis Tareas",
    description: "Analiza y prioriza tus tareas actuales",
    color: "violet",
  },
  hr: {
    label: "RRHH",
    description: "Consulta políticas, procedimientos y gestión de personal",
    color: "emerald",
  },
};

const SUGGESTIONS: Record<Mode, string[]> = {
  general: [
    "¿Cómo puedo mejorar la comunicación en mi equipo?",
    "¿Qué técnicas de gestión del tiempo recomiendas?",
    "Explícame las mejores prácticas de onboarding",
  ],
  tasks: [
    "¿Qué tareas tengo vencidas o próximas a vencer?",
    "Ayúdame a priorizar mis tareas según urgencia",
    "¿Cuál es mi carga de trabajo actual?",
  ],
  hr: [
    "¿Cómo manejar un conflicto entre dos colaboradores?",
    "¿Cuál es el procedimiento para solicitar una licencia médica?",
    "¿Qué pasos seguir ante un caso de bajo desempeño reiterado?",
  ],
};

function uid() {
  return Math.random().toString(36).slice(2);
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function SourceTag({ source }: { source: Source }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {source.title}, pág. {source.pageNumber}
    </span>
  );
}

export default function AssistantModule({
  currentUserRole,
}: {
  currentUserRole: Role;
}) {
  const canUpload = canManageUsers(currentUserRole);

  const [mode, setMode] = useState<Mode>("general");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Knowledge base
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [docTitle, setDocTitle] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch("/api/assistant/documents");
      if (res.ok) setDocs(await res.json());
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "hr") loadDocs();
  }, [mode, loadDocs]);

  function changeMode(m: Mode) {
    setMode(m);
    setMessages([]);
    setInput("");
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");

    const userMsg: Message = { id: uid(), role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, message: content, history }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: data.error ?? "Error al obtener respuesta." },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: data.content, sources: data.sources ?? [] },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: "Error de conexión. Intenta de nuevo." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !docTitle.trim()) {
      setUploadError("Completa el título antes de seleccionar el archivo.");
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", docTitle.trim());
      const res = await fetch("/api/assistant/documents", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Error al subir documento.");
      } else {
        setDocTitle("");
        await loadDocs();
      }
    } catch {
      setUploadError("Error de conexión al subir.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteDoc(id: string) {
    if (!confirm("¿Eliminar este documento de la base de conocimiento?")) return;
    await fetch(`/api/assistant/documents/${id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  const availableModes: Mode[] = ["general", "tasks", "hr"];

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Mode selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {availableModes.map((m) => {
          const cfg = MODE_CONFIG[m];
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => changeMode(m)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                active
                  ? m === "hr"
                    ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                    : m === "tasks"
                    ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                    : "bg-primary text-white border-primary shadow-sm"
                  : "bg-surface text-main border-border hover:border-primary/40 hover:text-title"
              }`}
            >
              {m === "general" && (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              )}
              {m === "tasks" && (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              )}
              {m === "hr" && (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
              {cfg.label}
            </button>
          );
        })}
        <span className="text-xs text-disabled ml-1 hidden sm:inline">
          {MODE_CONFIG[mode].description}
        </span>
        <span className="ml-auto text-[10px] text-disabled bg-background border border-border px-2 py-1 rounded-lg">
          Nova · llama-3.3-70b · Groq
        </span>
      </div>

      {/* Knowledge base panel (HR mode + admin only) */}
      {mode === "hr" && (
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setShowDocs((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
              </svg>
              <span className="text-sm font-semibold text-main">Base de conocimiento</span>
              {!docsLoading && (
                <span className="text-xs text-disabled">
                  {docs.length} {docs.length === 1 ? "documento" : "documentos"}
                </span>
              )}
            </div>
            <svg
              className={`w-4 h-4 text-disabled transition-transform ${showDocs ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showDocs && (
            <div className="border-t border-border px-5 py-4 space-y-4">
              {/* Upload form (admin only) */}
              {canUpload && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-main uppercase tracking-wide">
                    Agregar documento PDF
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Título del documento…"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      className="flex-1 border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                    <button
                      onClick={() => {
                        if (!docTitle.trim()) {
                          setUploadError("Ingresa un título primero.");
                          return;
                        }
                        setUploadError("");
                        fileInputRef.current?.click();
                      }}
                      disabled={uploading}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {uploading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      )}
                      {uploading ? "Procesando…" : "Subir PDF"}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={handleUpload}
                    />
                  </div>
                  {uploadError && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {uploadError}
                    </p>
                  )}
                  {uploading && (
                    <p className="text-xs text-secondary">
                      Extrayendo texto y generando embeddings… esto puede tardar unos segundos en el primer documento.
                    </p>
                  )}
                </div>
              )}

              {/* Document list */}
              {docsLoading ? (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : docs.length === 0 ? (
                <p className="text-sm text-disabled text-center py-4">
                  No hay documentos en la base de conocimiento.
                  {canUpload ? " Sube un PDF para comenzar." : ""}
                </p>
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-3 bg-background rounded-xl px-4 py-3"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <svg className="w-4 h-4 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z" />
                        </svg>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-title truncate">{doc.title}</p>
                          <p className="text-[10px] text-disabled">
                            {doc.fileName} · {doc._count.chunks} fragmentos · {new Date(doc.createdAt).toLocaleDateString("es-CL")}
                          </p>
                        </div>
                      </div>
                      {canUpload && (
                        <button
                          onClick={() => handleDeleteDoc(doc.id)}
                          className="p-1.5 text-disabled hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                          title="Eliminar documento"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-surface rounded-2xl border border-border overflow-hidden min-h-[520px]">
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                mode === "hr" ? "bg-emerald-100" : mode === "tasks" ? "bg-violet-100" : "bg-indigo-100"
              }`}>
                <svg className={`w-7 h-7 ${
                  mode === "hr" ? "text-emerald-600" : mode === "tasks" ? "text-violet-600" : "text-primary"
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.415 2.798H4.213c-1.444 0-2.414-1.798-1.414-2.798L4.8 15.3" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-title">Nova — {MODE_CONFIG[mode].label}</p>
                <p className="text-sm text-secondary mt-1">{MODE_CONFIG[mode].description}</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-md">
                {SUGGESTIONS[mode].map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-left text-sm px-4 py-2.5 bg-background border border-border rounded-xl hover:bg-black/5 dark:hover:bg-white/5 hover:border-primary/40 transition-colors text-main"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                msg.role === "user"
                  ? "bg-primary text-white"
                  : mode === "hr"
                  ? "bg-emerald-100 text-emerald-700"
                  : mode === "tasks"
                  ? "bg-violet-100 text-violet-700"
                  : "bg-indigo-100 text-primary"
              }`}>
                {msg.role === "user" ? "Tú" : "N"}
              </div>
              <div className={`max-w-[78%] space-y-1.5 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-white rounded-tr-sm"
                    : "bg-black/5 dark:bg-white/5 text-title rounded-tl-sm"
                }`}>
                  {msg.content}
                </div>
                {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {msg.sources.map((src, i) => (
                      <SourceTag key={i} source={src} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                mode === "hr" ? "bg-emerald-100 text-emerald-700" : mode === "tasks" ? "bg-violet-100 text-violet-700" : "bg-indigo-100 text-primary"
              }`}>N</div>
              <div className="bg-black/5 dark:bg-white/5 rounded-2xl rounded-tl-sm">
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border p-4">
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={`Escribe un mensaje… (${mode === "hr" ? "políticas, procedimientos, gestión de personal…" : mode === "tasks" ? "pregunta sobre tus tareas" : "cualquier pregunta"})`}
              className="flex-1 border border-border rounded-xl px-4 py-2.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none overflow-hidden leading-relaxed"
              style={{ minHeight: "42px" }}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className={`p-2.5 rounded-xl text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
                mode === "hr" ? "bg-emerald-600 hover:bg-emerald-700" : mode === "tasks" ? "bg-violet-600 hover:bg-violet-700" : "bg-primary hover:bg-primary-hover"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-disabled mt-1.5 text-center">
            Enter para enviar · Shift+Enter para nueva línea
          </p>
        </div>
      </div>
    </div>
  );
}
