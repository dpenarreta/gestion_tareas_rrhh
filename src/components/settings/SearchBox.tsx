"use client";

import { Search, X } from "lucide-react";

export default function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-disabled pointer-events-none" strokeWidth={1.8} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar configuración… (ej: ventana, retención, carga)"
        className="w-full pl-9 pr-9 py-2 text-sm border border-border rounded-lg bg-surface text-title focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-disabled hover:text-main"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
