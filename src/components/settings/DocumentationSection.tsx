"use client";

import { useCallback, useEffect, useState } from "react";
import { marked } from "marked";
import SectionCard from "./SectionCard";

type DocKey = "version" | "changelog" | "decisions" | "roadmap" | "architecture" | "formulas";

const DOC_TABS: { key: DocKey; label: string }[] = [
  { key: "version", label: "Historial de versiones" },
  { key: "changelog", label: "Changelog" },
  { key: "decisions", label: "Decisiones" },
  { key: "roadmap", label: "Roadmap" },
  { key: "architecture", label: "Arquitectura" },
  { key: "formulas", label: "Fórmulas Analytics" },
];

/**
 * Panel de solo lectura — lee los .md de /docs directamente vía
 * /api/settings/documentation, sin duplicar su contenido en una tabla
 * (Sprint de Documentación §9). Solo Administrador, igual que el resto de
 * SettingsManager.tsx.
 */
export default function DocumentationSection() {
  const [tab, setTab] = useState<DocKey>("version");
  const [html, setHtml] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: DocKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/documentation?doc=${key}`);
      const data: { content?: string; updatedAt?: string; error?: string } = await res.json();
      if (!res.ok || !data.content) {
        setError(data.error ?? "No se pudo cargar el documento");
        setHtml("");
        setUpdatedAt(null);
        return;
      }
      setHtml(await marked.parse(data.content));
      setUpdatedAt(data.updatedAt ?? null);
    } catch {
      setError("Error de conexión");
      setHtml("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => load(tab));
  }, [tab, load]);

  return (
    <SectionCard title="Documentación">
      <p className="text-xs text-secondary">
        Vista de solo lectura de la documentación técnica en <code className="text-[11px]">/docs</code> —
        el contenido se lee directamente de los archivos Markdown del repositorio, no se duplica aquí.
      </p>

      <div className="flex flex-wrap gap-1 bg-background rounded-lg p-1 w-fit">
        {DOC_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === t.key ? "bg-surface text-title shadow-sm" : "text-secondary hover:text-title"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger bg-danger/[.09] rounded-lg px-4 py-3">{error}</p>}

      {loading && (
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && !error && html && (
        <>
          {updatedAt && (
            <p className="text-[11px] text-disabled">
              Última modificación del archivo: {new Date(updatedAt).toLocaleString("es-CL")}
            </p>
          )}
          <div
            className="doc-markdown rounded-lg border border-border bg-background px-5 py-4 max-h-[70vh] overflow-y-auto text-sm text-main [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-title [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-title [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-title [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:mb-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-1 [&_code]:text-[12px] [&_code]:bg-surface2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-surface2 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_table]:w-full [&_table]:text-xs [&_table]:my-3 [&_th]:text-left [&_th]:border [&_th]:border-border [&_th]:bg-surface2 [&_th]:px-2 [&_th]:py-1.5 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_a]:text-primary [&_a]:hover:underline [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-secondary [&_blockquote]:my-2 [&_hr]:border-border [&_hr]:my-4"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </>
      )}
    </SectionCard>
  );
}
