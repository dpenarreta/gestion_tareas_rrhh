"use client";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

type Props = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  selectClassName?: string;
};

const DEFAULT_SELECT_CLASS =
  "w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary";

export default function TimeInput24({ value, onChange, required, selectClassName }: Props) {
  const [h, m] = value ? value.split(":") : ["", ""];
  const selectClass = selectClassName ?? DEFAULT_SELECT_CLASS;

  return (
    <div className="w-full flex items-center gap-1">
      <select
        required={required}
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m || "00"}`)}
        className={selectClass}
        aria-label="Hora"
      >
        <option value="" disabled>HH</option>
        {HOURS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <span className="text-secondary font-medium shrink-0">:</span>
      <select
        required={required}
        value={m}
        onChange={(e) => onChange(`${h || "00"}:${e.target.value}`)}
        className={selectClass}
        aria-label="Minutos"
      >
        <option value="" disabled>MM</option>
        {MINUTES.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}
