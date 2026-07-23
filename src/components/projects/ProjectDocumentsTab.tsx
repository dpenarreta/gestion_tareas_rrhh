"use client";

import { useEffect, useState } from "react";
import type { ProjectDocument, ProjectDocumentCategory } from "./types";
import { DOCUMENT_CATEGORY_LABEL } from "./types";

const CATEGORY_OPTIONS: ProjectDocumentCategory[] = ["PDF", "EXCEL", "WORD", "IMAGEN", "CORREO", "ACTA", "OTRO"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProjectDocumentsTab({ projectId, canUpload }: { projectId: string; canUpload: boolean }) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<ProjectDocumentCategory>("OTRO");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/documents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDocuments(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function upload() {
    if (!file || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const fileData = await fileToBase64(file);
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileData, category }),
      });
      if (res.ok) {
        const created = await res.json();
        setDocuments((prev) => [created, ...prev]);
        setFile(null);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al subir el documento");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function download(doc: ProjectDocument) {
    setDownloadingId(doc.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/${doc.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const link = document.createElement("a");
      link.href = `data:${data.mimeType || "application/octet-stream"};base64,${data.fileData}`;
      link.download = data.fileName;
      link.click();
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Categoría</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProjectDocumentCategory)}
              className="border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>{DOCUMENT_CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Archivo</label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-title file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary-surface file:text-primary file:text-xs file:font-medium"
            />
          </div>
          <button
            onClick={upload}
            disabled={!file || submitting}
            className="bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40"
          >
            {submitting ? "Subiendo…" : "Subir"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

      {loading && <div className="text-center text-disabled text-sm py-8">Cargando…</div>}
      {!loading && documents.length === 0 && (
        <div className="text-center text-disabled text-sm py-12 bg-surface border border-border rounded-2xl">Sin documentos todavía</div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-title truncate">
                {doc.fileName}
                {doc.version > 1 && <span className="text-xs text-disabled ml-1">v{doc.version}</span>}
              </p>
              <p className="text-xs text-secondary">
                {DOCUMENT_CATEGORY_LABEL[doc.category]} · {doc.uploadedBy.name} · {formatDate(doc.createdAt)}
              </p>
            </div>
            <button
              onClick={() => download(doc)}
              disabled={downloadingId === doc.id}
              className="text-xs font-medium text-primary hover:text-primary-hover shrink-0 disabled:opacity-40"
            >
              Descargar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
