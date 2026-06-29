"use client";

import { useEffect, useRef } from "react";
import type { ViewType } from "./types";

const VIEW_INFO: Record<ViewType, { label: string; description: string; icon: React.ReactNode }> = {
  KANBAN: {
    label: "Kanban",
    description: "Tablero de columnas por estado",
    icon: (
      <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  TABLA: {
    label: "Tabla",
    description: "Lista con columnas editables",
    icon: (
      <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18M10 3v18M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6z" />
      </svg>
    ),
  },
  GANTT: {
    label: "Gantt",
    description: "Línea de tiempo por fechas",
    icon: (
      <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
};

type Props = {
  availableViews: ViewType[];
  onAdd: (view: ViewType) => void;
  onClose: () => void;
};

export default function AddViewPanel({ availableViews, onAdd, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 w-72"
    >
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Agregar vista
      </p>
      <div className="flex flex-col gap-2">
        {availableViews.map((view) => {
          const info = VIEW_INFO[view];
          return (
            <button
              key={view}
              onClick={() => onAdd(view)}
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left group"
            >
              <div className="shrink-0 p-1.5 rounded-lg bg-slate-50 group-hover:bg-white transition-colors">
                {info.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{info.label}</p>
                <p className="text-xs text-slate-500">{info.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
