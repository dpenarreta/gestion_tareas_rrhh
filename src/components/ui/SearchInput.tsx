import { Search, X } from "lucide-react";
import type { InputHTMLAttributes } from "react";

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
};

export function SearchInput({ value, onChange, onClear, className = "", placeholder = "Buscar…", ...props }: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-disabled pointer-events-none" strokeWidth={2} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full pl-9 pr-8 py-2 text-sm text-title bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary ${className}`}
        {...props}
      />
      {value && (onClear ?? (() => onChange(""))) && (
        <button
          type="button"
          onClick={() => (onClear ? onClear() : onChange(""))}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-disabled hover:text-main"
          aria-label="Limpiar búsqueda"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
