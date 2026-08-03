"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Preview = {
  year: number;
  month: number;
  alreadyClosed: boolean;
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  continuedActive: number;
  cutoffDate: string;
  closureType: "NORMAL" | "EARLY" | "MANUAL";
  calendarDaysTotal: number;
  calendarDaysConsidered: number;
  workingDaysConsidered: number;
  workingHoursConsidered: number;
};

type Result = {
  archivedCount: number;
  duplicatedCount: number;
  continuedActiveCount: number;
  nextMonth: number;
  nextYear: number;
  cutoffDate: string;
  closureType: "NORMAL" | "EARLY" | "MANUAL";
};

function monthLabel(year: number, month: number) {
  const label = new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function nextMonthOf(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function shortDayMonth(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\.$/, "");
}

type Props = {
  onClose: () => void;
  onClosed: () => void;
};

export default function CloseMonthModal({ onClose, onClosed }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<{ year: number; month: number } | null>(null);
  const [cutoffDate, setCutoffDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  function applyPreview(data: Preview) {
    setPreview(data);
    setSelected({ year: data.year, month: data.month });
    setCutoffDate(data.cutoffDate);
  }

  function fetchPreview(year: number, month: number, cutoff?: string) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (cutoff) params.set("cutoffDate", cutoff);
    fetch(`/api/tasks/close-month?${params.toString()}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error ?? "No se pudo cargar el resumen");
          return;
        }
        applyPreview(data as Preview);
      })
      .catch(() => setError("No se pudo cargar el resumen"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetch("/api/tasks/close-month")
      .then((r) => r.json())
      .then((data: Preview) => applyPreview(data))
      .catch(() => setError("No se pudo cargar el resumen"))
      .finally(() => setLoading(false));
  }, []);

  function handleMonthChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value; // "YYYY-MM"
    if (!value) return;
    const [y, m] = value.split("-").map(Number);
    fetchPreview(y, m);
  }

  function handleCutoffChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value; // "YYYY-MM-DD"
    setCutoffDate(value);
    if (!value || !selected) return;
    fetchPreview(selected.year, selected.month, value);
  }

  async function handleConfirm() {
    if (!selected) return;
    setClosing(true);
    setError("");
    try {
      const res = await fetch("/api/tasks/close-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selected, cutoffDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al cerrar el mes");
        return;
      }
      setResult(data);
      onClosed();
    } finally {
      setClosing(false);
    }
  }

  const next = selected ? nextMonthOf(selected.year, selected.month) : null;
  const periodStartIso = selected ? `${selected.year}-${String(selected.month).padStart(2, "0")}-01` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-title">Cerrar mes</h2>
          <button onClick={onClose} aria-label="Cerrar" className="p-2 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!result && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1 uppercase tracking-wide">
                  1 · Período
                </label>
                <input
                  type="month"
                  value={selected ? `${selected.year}-${String(selected.month).padStart(2, "0")}` : ""}
                  onChange={handleMonthChange}
                  disabled={loading || closing}
                  className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary text-sm disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-disabled">
                  Por defecto se muestra el mes anterior al actual. Cambia el mes para cierres tardíos.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-secondary mb-1 uppercase tracking-wide">
                  2 · Fecha de corte
                </label>
                <input
                  type="date"
                  value={cutoffDate}
                  min={periodStartIso ?? undefined}
                  max={preview ? `${preview.year}-${String(preview.month).padStart(2, "0")}-${String(preview.calendarDaysTotal).padStart(2, "0")}` : undefined}
                  onChange={handleCutoffChange}
                  disabled={loading || closing || !selected}
                  className="w-full px-3 py-2 rounded-xl border border-border text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary text-sm disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-disabled">
                  Por defecto, el último día del mes. Elige una fecha anterior para un cierre anticipado o una regularización.
                </p>
              </div>
            </div>
          )}

          {loading && <p className="text-sm text-disabled text-center py-4">Cargando resumen…</p>}

          {error && (
            <div className="text-sm text-danger bg-danger/[.09] rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          {!loading && preview && selected && next && !result && (
            <>
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1 uppercase tracking-wide">
                  3 · Vista previa
                </label>
                <p className="text-sm text-main">
                  Cerrando el mes de: <span className="font-semibold">{monthLabel(preview.year, preview.month)} {preview.year}</span>
                </p>
                <p className="text-sm text-main">
                  Las tareas se duplicarán para: <span className="font-semibold">{monthLabel(next.year, next.month)} {next.year}</span>
                </p>
              </div>

              {preview.alreadyClosed ? (
                <div className="text-sm text-warning bg-warning/[.15] rounded-xl px-4 py-2.5">
                  Este mes ya fue cerrado anteriormente.
                </div>
              ) : (
                <>
                  {preview.closureType !== "NORMAL" && (
                    <div className="text-sm text-primary bg-primary-surface border border-primary/25 rounded-xl px-4 py-2.5">
                      {preview.closureType === "EARLY" ? "Cierre anticipado" : "Corte regularizado manualmente"} — solo se considerará información hasta el {shortDayMonth(preview.cutoffDate)}.
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-border px-3 py-2.5">
                      <p className="text-xs text-disabled">Cobertura</p>
                      <p className="text-sm font-bold text-title">
                        {periodStartIso ? shortDayMonth(periodStartIso) : "—"} – {shortDayMonth(preview.cutoffDate)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border px-3 py-2.5">
                      <p className="text-xs text-disabled">Días hábiles</p>
                      <p className="text-sm font-bold text-title">{preview.workingDaysConsidered}</p>
                    </div>
                    <div className="rounded-xl border border-border px-3 py-2.5 col-span-2">
                      <p className="text-xs text-disabled">Horas base consideradas</p>
                      <p className="text-sm font-bold text-title">{preview.workingHoursConsidered}h</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-border px-3 py-2.5">
                      <p className="text-xs text-disabled">Total tareas</p>
                      <p className="text-lg font-bold text-title">{preview.total}</p>
                    </div>
                    <div className="rounded-xl border border-transparent bg-success/[.13] px-3 py-2.5">
                      <p className="text-xs text-success">Completadas</p>
                      <p className="text-lg font-bold text-success">{preview.completed}</p>
                    </div>
                    <div className="rounded-xl border border-transparent bg-warning/[.15] px-3 py-2.5">
                      <p className="text-xs text-warning">Pendientes</p>
                      <p className="text-lg font-bold text-warning">{preview.pending}</p>
                    </div>
                    <div className="rounded-xl border border-transparent bg-primary-surface px-3 py-2.5">
                      <p className="text-xs text-primary">En progreso</p>
                      <p className="text-lg font-bold text-primary">{preview.inProgress}</p>
                    </div>
                  </div>

                  {preview.continuedActive > 0 && (
                    <div className="rounded-xl border border-primary/25 bg-primary-surface px-3 py-2.5">
                      <p className="text-xs text-primary">Seguimiento que continúa activo (no se cierra)</p>
                      <p className="text-lg font-bold text-primary">{preview.continuedActive}</p>
                    </div>
                  )}

                  <div className="text-xs text-main bg-background border border-border rounded-xl px-4 py-2.5">
                    Las tareas pasarán al repositorio. Las recurrentes se duplicarán para el mes siguiente.
                    {preview.continuedActive > 0 && " Las de Seguimiento pendientes o en progreso continúan activas, sin archivarse."}
                  </div>
                </>
              )}
            </>
          )}

          {result && (
            <div className="text-sm text-success bg-success/[.13] rounded-xl px-4 py-3 space-y-1">
              <p>{result.archivedCount} tareas archivadas, {result.duplicatedCount} tareas creadas para {monthLabel(result.nextYear, result.nextMonth)} {result.nextYear}.</p>
              {result.continuedActiveCount > 0 && (
                <p>{result.continuedActiveCount} tarea{result.continuedActiveCount !== 1 ? "s" : ""} de Seguimiento continuaron activas sin cerrarse.</p>
              )}
              {result.closureType !== "NORMAL" && (
                <p>Fecha de corte: {shortDayMonth(result.cutoffDate)} ({result.closureType === "EARLY" ? "cierre anticipado" : "corte regularizado manualmente"}).</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            {!result ? (
              <>
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={loading || closing || !preview || preview.alreadyClosed}
                >
                  {closing ? "Cerrando..." : "Confirmar cierre"}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={onClose}>
                Listo
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
