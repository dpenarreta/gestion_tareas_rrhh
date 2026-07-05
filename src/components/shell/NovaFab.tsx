"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send } from "lucide-react";
import { useNovaChat } from "@/components/assistant/useNovaChat";

export default function NovaFab() {
  const [open, setOpen] = useState(false);
  const { messages, input, setInput, loading, sendMessage } = useNovaChat("general");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[calc(100vw-2.5rem)] sm:w-[370px] h-[70vh] sm:h-[480px] bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-pop">
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: "var(--gradient-nova)" }}
          >
            <div className="flex items-center gap-2 text-white">
              <Sparkles className="w-4 h-4" strokeWidth={2} />
              <span className="text-[13px] font-semibold">Nova</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg text-white/90 hover:bg-white/15 transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.length === 0 && (
              <p className="text-[13px] text-secondary text-center py-6">
                Pregúntale algo a Nova sobre Nexo o tu trabajo.
              </p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-white rounded-tr-sm"
                      : "bg-surface2 text-title rounded-tl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface2 rounded-2xl rounded-tl-sm px-3 py-2 text-[13px] text-secondary">
                  Nova está escribiendo…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-border p-2.5 shrink-0">
            <div className="flex gap-2 items-end">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Escribe un mensaje…"
                className="flex-1 border border-border2 rounded-[10px] bg-surface2 px-3 py-2 text-[13px] text-title placeholder-disabled focus:outline-none focus:border-primary focus:ring-[3px]"
                style={{ ["--tw-ring-color" as string]: "var(--primsoft)" }}
                disabled={loading}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="p-2 rounded-[9px] text-white disabled:opacity-40 transition-colors shrink-0"
                style={{ background: "var(--gradient-nova)" }}
                aria-label="Enviar"
              >
                <Send className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar Nova" : "Abrir Nova"}
        className="w-14 h-14 rounded-full flex items-center justify-center text-white shadow-2xl hover:brightness-110 transition-all"
        style={{ background: "var(--gradient-nova)" }}
      >
        {open ? <X className="w-6 h-6" strokeWidth={2} /> : <Sparkles className="w-6 h-6" strokeWidth={2} />}
      </button>
    </div>
  );
}
