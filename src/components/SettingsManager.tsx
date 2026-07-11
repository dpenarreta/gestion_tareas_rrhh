"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  dataConsentAccepted: boolean;
  dataConsentAcceptedAt: string | null;
};

type SystemInfo = {
  version: string;
  commitSha: string | null;
  serverStartedAt: string;
  totalUsers: number;
  totalTasks: number;
  totalMeetings: number;
  totalIdeas: number;
};

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Cuenta días lunes-viernes de un mes calendario (para la vista previa del cálculo mensual). */
function businessDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <h3 className="font-semibold text-title">{title}</h3>
      {children}
    </div>
  );
}

export default function SettingsManager({ currentUserRole }: { currentUserRole: Role }) {
  const isAdmin = currentUserRole === "ADMINISTRADOR";
  const canManageKnowledgeBase = isAdmin;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);

  // Configuración de carga laboral
  const [hoursPerDay, setHoursPerDay] = useState<number | null>(null);
  const [hoursInput, setHoursInput] = useState("6.5");
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMsg, setHoursMsg] = useState<string | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);

  // Base de conocimiento RRHH
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docTitle, setDocTitle] = useState("");
  const [docAdding, setDocAdding] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docBusyId, setDocBusyId] = useState<string | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSystemInfo = useCallback(async () => {
    setInfoLoading(true);
    try {
      const res = await fetch("/api/settings/system-info");
      if (res.ok) setSystemInfo(await res.json());
    } finally {
      setInfoLoading(false);
    }
  }, []);

  const loadHoursConfig = useCallback(async () => {
    setHoursLoading(true);
    try {
      const res = await fetch("/api/settings/workload-config");
      if (res.ok) {
        const data = await res.json();
        setHoursPerDay(data.hoursPerDay);
        setHoursInput(String(data.hoursPerDay));
      }
    } finally {
      setHoursLoading(false);
    }
  }, []);

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
    if (isAdmin) {
      queueMicrotask(loadUsers);
      queueMicrotask(loadSystemInfo);
      queueMicrotask(loadHoursConfig);
    }
    if (canManageKnowledgeBase) queueMicrotask(loadDocs);
  }, [isAdmin, canManageKnowledgeBase, loadUsers, loadSystemInfo, loadHoursConfig, loadDocs]);

  async function handleSaveHours() {
    const value = parseFloat(hoursInput);
    setHoursMsg(null);
    setHoursError(null);
    setHoursSaving(true);
    try {
      const res = await fetch("/api/settings/workload-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursPerDay: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setHoursError(data.error ?? "Error al guardar la configuración");
      } else {
        setHoursPerDay(data.hoursPerDay);
        setHoursMsg("Configuración de carga laboral actualizada.");
      }
    } catch {
      setHoursError("Error de conexión");
    } finally {
      setHoursSaving(false);
    }
  }

  async function handleAddDoc(file: File) {
    if (!docTitle.trim()) {
      setDocError("Ingresa el nombre del documento antes de seleccionar el archivo.");
      return;
    }
    const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      setDocError("El archivo supera el límite de 4.5MB. Por favor usa un archivo más pequeño.");
      if (docFileInputRef.current) docFileInputRef.current.value = "";
      return;
    }
    setDocError(null);
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
        setDocError(res.ok ? "Error al agregar el documento." : `Error al agregar el documento (código ${res.status}).`);
        return;
      }
      if (!res.ok) {
        setDocError(data.error ?? "Error al agregar el documento");
      } else {
        setDocTitle("");
        await loadDocs();
      }
    } catch {
      setDocError("Error de conexión");
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

  async function handleResetConsent(user: User) {
    if (
      !confirm(
        `¿Deseas que ${user.name} vea nuevamente el aviso de protección de datos en su próximo login?`
      )
    )
      return;
    setMsg(null);
    setError(null);
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-consent`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al restablecer el consentimiento");
      } else {
        setMsg(`Se restableció el aviso de protección de datos para ${user.name}.`);
        loadUsers();
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetConsentAll() {
    if (
      !confirm(
        "¿Deseas restablecer el consentimiento de protección de datos de TODOS los usuarios? Todos verán nuevamente el aviso en su próximo login."
      )
    )
      return;
    if (
      !confirm(
        "Esta acción afecta a todos los usuarios del sistema y no se puede deshacer. ¿Confirmas que deseas continuar?"
      )
    )
      return;
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/users/reset-consent-all", { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al restablecer el consentimiento");
      } else {
        setMsg(`Se restableció el consentimiento de ${data.count} usuario(s).`);
        loadUsers();
      }
    } catch {
      setError("Error de conexión");
    }
  }

  async function handleResetPassword(user: User) {
    setMsg(null);
    setError(null);
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al resetear");
      } else {
        setMsg(data.message);
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="ml-2 text-success hover:brightness-90 font-bold">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">
            ×
          </button>
        </div>
      )}

      {isAdmin && (
      <>
      <SectionCard title="Consentimiento de datos">
        <div className="flex justify-end">
          <button
            onClick={handleResetConsentAll}
            className="px-4 py-2 border border-border hover:bg-black/5 dark:hover:bg-white/5 text-main font-medium rounded-lg text-sm transition-colors"
          >
            🔄 Restablecer todos
          </button>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-4 py-2.5 font-medium text-main">Usuario</th>
                  <th className="text-left px-4 py-2.5 font-medium text-main">Estado</th>
                  <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 text-title font-medium">
                      {u.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.dataConsentAccepted ? (
                        <span className="px-2.5 py-1 bg-success/[.13] text-success rounded-full text-xs font-medium">
                          Aceptado
                          {u.dataConsentAcceptedAt && ` · ${formatDate(u.dataConsentAcceptedAt)}`}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-surface2 text-secondary rounded-full text-xs font-medium">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleResetConsent(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors disabled:opacity-50"
                      >
                        🔄 Restablecer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Gestión de contraseñas">
        <div className="rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-4 py-2.5 font-medium text-main">Usuario</th>
                  <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 text-title font-medium">
                      {u.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleResetPassword(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-warning hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-warning/[.15] transition-colors disabled:opacity-50"
                        title="Resetear contraseña a 123456"
                      >
                        🔑 Resetear contraseña
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Información del sistema">
        {infoLoading || !systemInfo ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-disabled">Versión de Nexo</p>
              <p className="text-sm font-medium text-title">
                {systemInfo.version}
                {systemInfo.commitSha && ` (${systemInfo.commitSha})`}
              </p>
            </div>
            <div>
              <p className="text-xs text-disabled">Último despliegue (aprox.)</p>
              <p className="text-sm font-medium text-title">{formatDate(systemInfo.serverStartedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Usuarios registrados</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalUsers}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Tareas en el sistema</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalTasks}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Reuniones registradas</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalMeetings}</p>
            </div>
            <div>
              <p className="text-xs text-disabled">Ideas en Mejora Continua</p>
              <p className="text-sm font-medium text-title">{systemInfo.totalIdeas}</p>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Configuración de Carga Laboral">
        {hoursLoading || hoursPerDay === null ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {hoursMsg && (
              <div className="bg-success/[.13] rounded-lg px-4 py-3 text-sm text-success flex items-center justify-between">
                <span>{hoursMsg}</span>
                <button onClick={() => setHoursMsg(null)} className="ml-2 text-success hover:brightness-90 font-bold">×</button>
              </div>
            )}
            {hoursError && (
              <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
                <span>{hoursError}</span>
                <button onClick={() => setHoursError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-title">Horas efectivas por día laboral</label>
              <p className="text-xs text-secondary">
                Define las horas de trabajo efectivo por día, descontando pausas naturales. Las horas semanales y
                mensuales se calculan automáticamente.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="number"
                  min={4}
                  max={8}
                  step={0.5}
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                  className="w-28 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={handleSaveHours}
                  disabled={hoursSaving || parseFloat(hoursInput) === hoursPerDay}
                  className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
                >
                  {hoursSaving ? "Guardando…" : "Guardar configuración"}
                </button>
              </div>
            </div>
            {(() => {
              const preview = parseFloat(hoursInput);
              if (!Number.isFinite(preview) || preview < 4 || preview > 8) return null;
              const now = new Date();
              const bizDays = businessDaysInMonth(now.getFullYear(), now.getMonth() + 1);
              const monthLabel = now.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
              return (
                <div className="rounded-lg bg-background border border-border px-4 py-3 space-y-1 text-sm text-secondary">
                  <p>Horas semanales: <span className="font-medium text-title">{Math.round(preview * 5 * 10) / 10} horas</span> (5 días × {preview}h)</p>
                  <p>
                    Horas mensuales: varía según días laborables (ej: {monthLabel} = {bizDays} días ×{" "}
                    {preview}h = <span className="font-medium text-title">{Math.round(preview * bizDays * 10) / 10} horas</span>)
                  </p>
                </div>
              );
            })()}
          </>
        )}
      </SectionCard>
      </>
      )}

      {canManageKnowledgeBase && (
      <SectionCard title="Base de conocimiento RRHH">
        <p className="text-xs text-secondary">
          Sube el PDF desde tu computadora. Nexo lo guarda en el repositorio de documentos y lo indexa
          automáticamente para búsqueda semántica.
        </p>
        {docError && (
          <div className="bg-danger/[.09] rounded-lg px-4 py-3 text-sm text-danger flex items-center justify-between">
            <span>{docError}</span>
            <button onClick={() => setDocError(null)} className="ml-2 text-danger hover:brightness-90 font-bold">×</button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Nombre del documento…"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => {
              if (!docTitle.trim()) {
                setDocError("Ingresa el nombre del documento antes de seleccionar el archivo.");
                return;
              }
              setDocError(null);
              docFileInputRef.current?.click();
            }}
            disabled={docAdding}
            className="px-4 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors shrink-0"
          >
            {docAdding ? "Procesando…" : "Subir PDF"}
          </button>
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
            <div className="flex justify-center items-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-disabled text-center py-8">No hay documentos en la base de conocimiento.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-4 py-2.5 font-medium text-main">Documento</th>
                  <th className="text-left px-4 py-2.5 font-medium text-main">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-medium text-main">Estado</th>
                  <th className="text-right px-4 py-2.5 font-medium text-main">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-4 py-2.5 text-title font-medium">
                      {doc.title}
                      <span className="block text-xs text-disabled">{doc._count.chunks} fragmentos</span>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{new Date(doc.createdAt).toLocaleDateString("es-CL")}</td>
                    <td className="px-4 py-2.5">
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
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleDeleteDoc(doc)}
                        disabled={docBusyId === doc.id}
                        className="text-xs text-danger hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-danger/[.09] transition-colors disabled:opacity-50"
                      >
                        🗑️ Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>
      )}
    </div>
  );
}
