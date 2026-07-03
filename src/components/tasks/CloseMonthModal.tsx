"use client";

import { useEffect, useState } from "react";

type Preview = {
  year: number;
  month: number;
  alreadyClosed: boolean;
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
};

type Result = {
  archivedCount: number;
  duplicatedCount: number;
  nextMonth: number;
  nextYear: number;
};

function monthLabel(year: number, month: number) {
  const label = new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Props = {
  onClose: () => void;
  onClosed: () => void;
};

export default function CloseMonthModal({ onClose, onClosed }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch("/api/tasks/close-month")
      .then((r) => r.json())
      .then((data: Preview) => setPreview(data))
      .catch(() => setError("No se pudo cargar el resumen"))
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm() {
    setClosing(true);
    setError("");
    try {
      const res = await fetch("/api/tasks/close-month", { method: "POST" });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-title">Cerrar mes</h2>
          <button onClick={onClose} className="p-2 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {loading && <p className="text-sm text-disabled text-center py-4">Cargando resumen…</p>}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          {!loading && preview && !result && (
            <>
              <p className="text-sm text-main">
                Vas a cerrar <span className="font-semibold">{monthLabel(preview.year, preview.month)} {preview.year}</span>.
              </p>

              {preview.alreadyClosed ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  Este mes ya fue cerrado anteriormente.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-border px-3 py-2.5">
                      <p className="text-xs text-disabled">Total tareas</p>
                      <p className="text-lg font-bold text-title">{preview.total}</p>
                    </div>
                    <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
                      <p className="text-xs text-green-600">Completadas</p>
                      <p className="text-lg font-bold text-green-700">{preview.completed}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <p className="text-xs text-amber-600">Pendientes</p>
                      <p className="text-lg font-bold text-amber-700">{preview.pending}</p>
                    </div>
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                      <p className="text-xs text-blue-600">En progreso</p>
                      <p className="text-lg font-bold text-blue-700">{preview.inProgress}</p>
                    </div>
                  </div>

                  <div className="text-xs text-main bg-background border border-border rounded-xl px-4 py-2.5">
                    Las tareas pasarán al repositorio. Las recurrentes se duplicarán para el mes siguiente.
                  </div>
                </>
              )}
            </>
          )}

          {result && (
            <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              {result.archivedCount} tareas archivadas, {result.duplicatedCount} tareas creadas para {monthLabel(result.nextYear, result.nextMonth)} {result.nextYear}.
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            {!result ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={loading || closing || !preview || preview.alreadyClosed}
                  className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-50 transition-colors"
                >
                  {closing ? "Cerrando..." : "Confirmar cierre"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-xl hover:bg-primary-hover transition-colors"
              >
                Listo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
