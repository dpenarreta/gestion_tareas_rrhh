"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { FileX } from "lucide-react";

type DocStatus = "PROCESANDO" | "LISTO" | "ERROR";

type KnowledgeDoc = {
  id: string;
  title: string;
  githubPath: string | null;
  createdAt: string;
  status: DocStatus;
  processingError: string | null;
  uploadedBy?: { name: string };
  _count: { chunks: number };
};

const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  PROCESANDO: "Procesando…",
  LISTO: "Listo",
  ERROR: "Error",
};

const DOC_STATUS_CLASS: Record<DocStatus, string> = {
  PROCESANDO: "text-warning bg-warning/[.15]",
  LISTO: "text-success bg-success/[.13]",
  ERROR: "text-danger bg-danger/[.09]",
};

/** Base de conocimiento RRHH de Nova — extraído 1:1 de SettingsManager.tsx (Sprint O), sin cambios de lógica. */
export default function KnowledgeBaseSection() {
  const { showToast } = useToast();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docTitle, setDocTitle] = useState("");
  const [docAdding, setDocAdding] = useState(false);
  const [docBusyId, setDocBusyId] = useState<string | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch("/api/assistant/documents");
      if (res.ok) setDocs(await res.json());
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(loadDocs);
  }, [loadDocs]);

  async function handleAddDoc(file: File) {
    if (!docTitle.trim()) {
      showToast("Ingresa el nombre del documento antes de seleccionar el archivo.", "error");
      return;
    }
    const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast("El archivo supera el límite de 4.5MB. Por favor usa un archivo más pequeño.", "error");
      if (docFileInputRef.current) docFileInputRef.current.value = "";
      return;
    }
    setDocAdding(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", docTitle.trim());
      const res = await fetch("/api/assistant/documents", { method: "POST", body: fd });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        showToast(res.ok ? "Error al agregar el documento." : `Error al agregar el documento (código ${res.status}).`, "error");
        return;
      }
      if (!res.ok) {
        showToast(data.error ?? "Error al agregar el documento", "error");
      } else {
        setDocTitle("");
        showToast("Documento agregado correctamente.", "success");
        await loadDocs();
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setDocAdding(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  }

  async function handleDeleteDoc(doc: KnowledgeDoc) {
    if (!confirm(`¿Eliminar "${doc.title}" de la base de conocimiento?`)) return;
    setDocBusyId(doc.id);
    try {
      await fetch(`/api/assistant/documents/${doc.id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } finally {
      setDocBusyId(null);
    }
  }

  return (
    <SectionCard title="Base de conocimiento RRHH">
      <p className="text-xs text-secondary">
        Sube el PDF desde tu computadora. Nexo lo guarda en el repositorio de documentos y lo indexa
        automáticamente para búsqueda semántica.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Nombre del documento…"
          value={docTitle}
          onChange={(e) => setDocTitle(e.target.value)}
          className="flex-1 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <Button
          className="shrink-0"
          onClick={() => {
            if (!docTitle.trim()) {
              showToast("Ingresa el nombre del documento antes de seleccionar el archivo.", "error");
              return;
            }
            docFileInputRef.current?.click();
          }}
          disabled={docAdding}
        >
          {docAdding ? "Procesando…" : "Subir PDF"}
        </Button>
        <input
          ref={docFileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAddDoc(file);
          }}
        />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        {docsLoading ? (
          <div>
            <SkeletonRow columns={4} />
            <SkeletonRow columns={4} />
            <SkeletonRow columns={4} />
          </div>
        ) : docs.length === 0 ? (
          <EmptyState icon={FileX} title="Sin documentos en la base de conocimiento" description="No hay documentos en la base de conocimiento." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Documento</Th>
                <Th>Fecha</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc.id}>
                  <Td className="text-title font-medium">
                    {doc.title}
                    <span className="block text-xs text-disabled">{doc._count.chunks} fragmentos</span>
                  </Td>
                  <Td className="text-secondary">{new Date(doc.createdAt).toLocaleDateString("es-CL")}</Td>
                  <Td>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${DOC_STATUS_CLASS[doc.status]}`}>
                      {DOC_STATUS_LABEL[doc.status]}
                    </span>
                    {doc.processingError && (
                      <span
                        className={`block text-[10px] mt-0.5 ${doc.status === "ERROR" ? "text-danger" : "text-warning"}`}
                        title={doc.processingError}
                      >
                        {doc.processingError}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      onClick={() => handleDeleteDoc(doc)}
                      disabled={docBusyId === doc.id}
                      className="text-xs text-danger hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-danger/[.09] transition-colors disabled:opacity-50"
                    >
                      🗑️ Eliminar
                    </button>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SectionCard>
  );
}
