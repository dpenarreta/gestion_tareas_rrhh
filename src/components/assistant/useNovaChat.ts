"use client";

import { useCallback, useState } from "react";

export type NovaMode = "general" | "tasks" | "hr";
export type NovaSource = { title: string; fileName: string; pageNumber: number };
export type NovaMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: NovaSource[];
};

function uid() {
  return Math.random().toString(36).slice(2);
}

export function useNovaChat(mode: NovaMode) {
  const [messages, setMessages] = useState<NovaMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || loading) return;
      setInput("");

      const userMsg: NovaMessage = { id: uid(), role: "user", content };
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
      }
    },
    [input, loading, messages, mode]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setInput("");
  }, []);

  return { messages, input, setInput, loading, sendMessage, reset };
}
