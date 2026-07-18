"use client";

import { useEffect, useState } from "react";

const STORAGE_PREFIX = "nexo-settings-accordion:";

const DIACRITIC_RANGE = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RANGE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const storageKey = STORAGE_PREFIX + slugify(title);
  // Colapsado por defecto (primera visita, sin preferencia guardada); se restaura
  // desde localStorage para que la sección que el Admin dejó abierta reaparezca abierta.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (window.localStorage.getItem(storageKey) === "1") setExpanded(true);
    });
  }, [storageKey]);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-black/[.02] dark:hover:bg-white/[.03] transition-colors"
      >
        <h3 className="font-semibold text-title">{title}</h3>
        <span
          className={`text-secondary text-xs shrink-0 transition-transform duration-200 ${expanded ? "rotate-0" : "-rotate-90"}`}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5 space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
