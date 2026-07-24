"use client";

import { useEffect, useRef, useState } from "react";

// Ayuda contextual liviana (Sprint C §9) — mismo lenguaje visual que el
// HelpPopover de Analytics (badge "?"), pero para un solo texto corto en vez
// de las 4 secciones estructuradas de IndicatorHelp. Para módulos fuera de
// Analytics donde una explicación de una línea es suficiente.
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Más información"
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface2 text-disabled text-[9px] font-bold leading-none cursor-help shrink-0 hover:bg-primary-surface hover:text-primary transition-colors"
      >
        ?
      </button>
      {open && (
        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1.5 w-56 bg-surface border border-border rounded-xl shadow-xl p-3 text-xs text-secondary leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
