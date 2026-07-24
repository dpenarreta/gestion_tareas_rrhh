"use client";

import { useRef, useState } from "react";
import type { IdeaImpact } from "./types";
import { IMPACT_LABELS } from "./constants";
import { useToast } from "@/components/ui/Toast";

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export default function NewIdeaFormModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState<IdeaImpact>("MEDIO");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Título y descripción son obligatorios");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("description", description.trim());
      formData.append("impact", impact);
      if (file) formData.append("file", file);

      const res = await fetch("/api/ideas", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? "Error al proponer la idea.", "error");
        return;
      }
      showToast("Idea creada.", "success");
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-title">💡 Nueva idea</h2>
          <button onClick={onClose} className="p-2 text-disabled hover:text-main rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-danger bg-danger/[.09] rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Nombre de la idea"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Descripción detallada *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              placeholder="Explica el problema y la mejora propuesta"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Impacto esperado</label>
            <select
              value={impact}
              onChange={(e) => setImpact(e.target.value as IdeaImpact)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Object.entries(IMPACT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Archivo adjunto (opcional)</label>
            {!file ? (
              <input
                type="file"
                ref={fileInputRef}
                accept=".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-main file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface2 file:text-secondary hover:file:bg-border2"
              />
            ) : (
              <div className="flex items-center justify-between gap-2 border border-border rounded-xl px-3 py-2 bg-background">
                <span className="text-sm text-main truncate">📎 {file.name}</span>
                <button
                  type="button"
                  onClick={clearFile}
                  className="text-disabled hover:text-danger p-1 rounded shrink-0"
                  aria-label="Quitar archivo"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <p className="mt-1 text-[11px] text-disabled">Imagen o documento, máx. 8MB</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {saving ? "Enviando..." : "Proponer idea"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
