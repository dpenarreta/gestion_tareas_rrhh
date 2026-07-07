"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { Role } from "@/generated/prisma/client";
import { getNavLinks } from "@/lib/navLinks";

type Props = {
  role: Role;
  open: boolean;
  onClose: () => void;
};

export default function CommandPalette({ role, open, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const links = useMemo(() => getNavLinks(role), [role]);
  const filtered = links.filter((l) => l.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    queueMicrotask(() => { if (open) setQuery(""); });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden animate-pop">
        <div className="flex items-center gap-2.5 px-4 border-b border-border">
          <Search className="w-4 h-4 text-disabled shrink-0" strokeWidth={2} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ir a…"
            className="flex-1 py-3 bg-transparent text-[14px] text-title placeholder-disabled focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) go(filtered[0].href);
            }}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded bg-surface2 border border-border text-disabled shrink-0">
            Esc
          </kbd>
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <p className="text-sm text-disabled text-center py-6">Sin resultados</p>
          )}
          {filtered.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.href}
                onClick={() => go(link.href)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] text-main hover:bg-surface2 transition-colors"
              >
                <Icon className="w-4 h-4 text-secondary shrink-0" strokeWidth={1.8} />
                {link.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
