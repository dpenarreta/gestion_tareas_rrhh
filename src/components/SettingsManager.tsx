"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role, DataRequestType, DataRequestStatus } from "@/generated/prisma/client";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import SectionCard from "@/components/settings/SectionCard";
import NotificationRulesSection from "@/components/settings/NotificationRulesSection";
import ActivityReasonsSection from "@/components/settings/ActivityReasonsSection";
import HolidaysSection from "@/components/settings/HolidaysSection";
import LeaveRecordsSection from "@/components/settings/LeaveRecordsSection";
import SpecialStatusSection from "@/components/settings/SpecialStatusSection";
import KpiStartDateSection from "@/components/settings/KpiStartDateSection";
import AnalyticsConfigSection from "@/components/settings/AnalyticsConfigSection";
import PredictionWindowSection from "@/components/settings/PredictionWindowSection";
import NormalizationCurvesSection from "@/components/settings/NormalizationCurvesSection";
import RoleTargetsSection from "@/components/settings/RoleTargetsSection";
import WelcomeMessageSection from "@/components/settings/WelcomeMessageSection";
import EngineDiagnosticsSection from "@/components/settings/EngineDiagnosticsSection";
import DataQualitySection from "@/components/settings/DataQualitySection";
import DocumentationSection from "@/components/settings/DocumentationSection";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { FileX, ClipboardList } from "lucide-react";

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

type DataRequestRow = {
  id: string;
  type: DataRequestType;
  status: DataRequestStatus;
  description: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: { id: string; name: string; role: Role };
  resolver: { id: string; name: string } | null;
};

const REQUEST_TYPE_LABEL: Record<DataRequestType, string> = {
  ACCESO: "Acceso a datos",
  RECTIFICACION: "Rectificación",
  ELIMINACION: "Eliminación de cuenta",
};

const REQUEST_STATUS_LABEL: Record<DataRequestStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  RESUELTA: "Resuelta",
};

const REQUEST_STATUS_CLASS: Record<DataRequestStatus, string> = {
  PENDIENTE: "text-warning bg-warning/[.15]",
  EN_PROCESO: "text-primary bg-primary-surface",
  RESUELTA: "text-success bg-success/[.13]",
};

type RetentionPolicy = {
  monthlyReportsMonths: string;
  archivedTasksMonths: string;
  knowledgeDocsMonths: string;
};

const MONTHLY_REPORTS_OPTIONS = ["6", "12", "24", "36"];
const ARCHIVED_TASKS_OPTIONS = ["6", "12", "24", "36"];
const KNOWLEDGE_DOCS_OPTIONS = ["12", "24", "36", "indefinite"];

function monthsLabel(value: string): string {
  return value === "indefinite" ? "Indefinido" : `${value} meses`;
}

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

export default function SettingsManager({ currentUserRole }: { currentUserRole: Role }) {
  const isAdmin = currentUserRole === "ADMINISTRADOR";
  const canManageKnowledgeBase = isAdmin;
  const { showToast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [loginAttemptCleanupLoading, setLoginAttemptCleanupLoading] = useState(false);

  // Configuración de carga laboral — 4 límites independientes
  const [hoursPerDay, setHoursPerDay] = useState<number | null>(null);
  const [hoursInput, setHoursInput] = useState("6.30");
  const [workloadLimitLow, setWorkloadLimitLow] = useState<number | null>(null);
  const [limitLowInput, setLimitLowInput] = useState("5.30");
  const [workloadLimitHigh, setWorkloadLimitHigh] = useState<number | null>(null);
  const [limitHighInput, setLimitHighInput] = useState("7.30");
  const [workloadLimitOverload, setWorkloadLimitOverload] = useState<number | null>(null);
  const [limitOverloadInput, setLimitOverloadInput] = useState("8.30");
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hoursSaving, setHoursSaving] = useState(false);

  // Solicitudes de titulares de datos (LOPDP)
  const [dataRequests, setDataRequests] = useState<DataRequestRow[]>([]);
  const [dataRequestsLoading, setDataRequestsLoading] = useState(true);
  const [dataRequestBusyId, setDataRequestBusyId] = useState<string | null>(null);

  // Política de retención de datos (LOPDP)
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  // Base de conocimiento RRHH
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docTitle, setDocTitle] = useState("");
  const [docAdding, setDocAdding] = useState(false);
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
        setHoursInput(hoursToDisplay(data.hoursPerDay));
        setWorkloadLimitLow(data.workloadLimitLow);
        setLimitLowInput(hoursToDisplay(data.workloadLimitLow));
        setWorkloadLimitHigh(data.workloadLimitHigh);
        setLimitHighInput(hoursToDisplay(data.workloadLimitHigh));
        setWorkloadLimitOverload(data.workloadLimitOverload);
        setLimitOverloadInput(hoursToDisplay(data.workloadLimitOverload));
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

  const loadDataRequests = useCallback(async () => {
    setDataRequestsLoading(true);
    try {
      const res = await fetch("/api/data-requests");
      if (res.ok) setDataRequests(await res.json());
    } finally {
      setDataRequestsLoading(false);
    }
  }, []);

  const loadRetentionPolicy = useCallback(async () => {
    setRetentionLoading(true);
    try {
      const res = await fetch("/api/settings/retention-policy");
      if (res.ok) setRetentionPolicy(await res.json());
    } finally {
      setRetentionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      queueMicrotask(loadUsers);
      queueMicrotask(loadSystemInfo);
      queueMicrotask(loadHoursConfig);
      queueMicrotask(loadDataRequests);
      queueMicrotask(loadRetentionPolicy);
    }
    if (canManageKnowledgeBase) queueMicrotask(loadDocs);
  }, [
    isAdmin,
    canManageKnowledgeBase,
    loadUsers,
    loadSystemInfo,
    loadHoursConfig,
    loadDocs,
    loadDataRequests,
    loadRetentionPolicy,
  ]);

  async function handleSaveHours() {
    if (
      !validateDisplayHours(hoursInput) ||
      !validateDisplayHours(limitLowInput) ||
      !validateDisplayHours(limitHighInput) ||
      !validateDisplayHours(limitOverloadInput)
    ) {
      showToast(INVALID_HOURS_MESSAGE, "error");
      return;
    }
    const hoursValue = displayToHours(hoursInput);
    const limitLowValue = displayToHours(limitLowInput);
    const limitHighValue = displayToHours(limitHighInput);
    const limitOverloadValue = displayToHours(limitOverloadInput);
    setHoursSaving(true);
    try {
      const res = await fetch("/api/settings/workload-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hoursPerDay: hoursValue,
          workloadLimitLow: limitLowValue,
          workloadLimitHigh: limitHighValue,
          workloadLimitOverload: limitOverloadValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar la configuración", "error");
      } else {
        setHoursPerDay(data.hoursPerDay);
        setHoursInput(hoursToDisplay(data.hoursPerDay));
        setWorkloadLimitLow(data.workloadLimitLow);
        setLimitLowInput(hoursToDisplay(data.workloadLimitLow));
        setWorkloadLimitHigh(data.workloadLimitHigh);
        setLimitHighInput(hoursToDisplay(data.workloadLimitHigh));
        setWorkloadLimitOverload(data.workloadLimitOverload);
        setLimitOverloadInput(hoursToDisplay(data.workloadLimitOverload));
        showToast("Configuración de carga laboral actualizada.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setHoursSaving(false);
    }
  }

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

  async function handleResetConsent(user: User) {
    if (
      !confirm(
        `¿Deseas que ${user.name} vea nuevamente el aviso de protección de datos en su próximo login?`
      )
    )
      return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-consent`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al restablecer el consentimiento", "error");
      } else {
        showToast(`Se restableció el aviso de protección de datos para ${user.name}.`, "success");
        loadUsers();
      }
    } catch {
      showToast("Error de conexión", "error");
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
    try {
      const res = await fetch("/api/users/reset-consent-all", { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al restablecer el consentimiento", "error");
      } else {
        showToast(`Se restableció el consentimiento de ${data.count} usuario(s).`, "success");
        loadUsers();
      }
    } catch {
      showToast("Error de conexión", "error");
    }
  }

  async function handleResetPassword(user: User) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al resetear", "error");
      } else {
        showToast(data.message, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdateRequestStatus(request: DataRequestRow, status: DataRequestStatus) {
    setDataRequestBusyId(request.id);
    try {
      const res = await fetch(`/api/data-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDataRequests((prev) => prev.map((r) => (r.id === request.id ? updated : r)));
      }
    } finally {
      setDataRequestBusyId(null);
    }
  }

  async function handleSaveRetentionPolicy() {
    if (!retentionPolicy) return;
    setRetentionSaving(true);
    try {
      const res = await fetch("/api/settings/retention-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retentionPolicy),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar la política de retención", "error");
      } else {
        setRetentionPolicy(data);
        showToast("Política de retención actualizada.", "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setRetentionSaving(false);
    }
  }

  async function handleRunPurge() {
    setPurgeLoading(true);
    try {
      const previewRes = await fetch("/api/settings/retention-policy/purge");
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        showToast(preview.error ?? "Error al calcular la vista previa de depuración", "error");
        return;
      }
      const { reportsToDelete, tasksToDelete, docsToDelete } = preview;
      if (reportsToDelete === 0 && tasksToDelete === 0 && docsToDelete === 0) {
        showToast("No hay registros que superen la política de retención vigente.", "info");
        return;
      }
      if (
        !confirm(
          `Se eliminarán ${reportsToDelete} informe(s) mensual(es), ${tasksToDelete} tarea(s) archivada(s) y ${docsToDelete} documento(s) de la base de conocimiento. ¿Continuar?`
        )
      )
        return;
      if (
        !confirm(
          "Esta acción no se puede deshacer. ¿Confirmas que deseas ejecutar la depuración ahora?"
        )
      )
        return;

      const res = await fetch("/api/settings/retention-policy/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al ejecutar la depuración", "error");
      } else {
        showToast(
          `Depuración completada: ${data.reportsDeleted} informe(s), ${data.tasksDeleted} tarea(s) y ${data.docsDeleted} documento(s) eliminados.`,
          "success"
        );
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setPurgeLoading(false);
    }
  }

  async function handleCleanupLoginAttempts() {
    setLoginAttemptCleanupLoading(true);
    try {
      const previewRes = await fetch("/api/settings/login-attempts/cleanup");
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        showToast(preview.error ?? "Error al calcular los registros a limpiar", "error");
        return;
      }
      if (preview.expiredCount === 0) {
        showToast("No hay intentos de login expirados para limpiar.", "info");
        return;
      }
      if (
        !confirm(
          `Se eliminarán ${preview.expiredCount} registro(s) de intentos de login expirados (sin bloqueo vigente, con más de 30 días de antigüedad). ¿Continuar?`
        )
      )
        return;

      const res = await fetch("/api/settings/login-attempts/cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al limpiar los intentos de login", "error");
      } else {
        showToast(`Se eliminaron ${data.deleted} registro(s) de intentos de login expirados.`, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setLoginAttemptCleanupLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
      <>
      <SectionCard title="Consentimiento de datos">
        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleResetConsentAll}>
            🔄 Restablecer todos
          </Button>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div>
              <SkeletonRow columns={3} />
              <SkeletonRow columns={3} />
              <SkeletonRow columns={3} />
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <Th>Usuario</Th>
                  <Th>Estado</Th>
                  <Th className="text-right">Acción</Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <Td className="text-title font-medium">
                      {u.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                    </Td>
                    <Td>
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
                    </Td>
                    <Td className="text-right">
                      <button
                        onClick={() => handleResetConsent(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors disabled:opacity-50"
                      >
                        🔄 Restablecer
                      </button>
                    </Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Gestión de contraseñas">
        <div className="rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div>
              <SkeletonRow columns={2} />
              <SkeletonRow columns={2} />
              <SkeletonRow columns={2} />
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <Th>Usuario</Th>
                  <Th className="text-right">Acción</Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <Td className="text-title font-medium">
                      {u.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                    </Td>
                    <Td className="text-right">
                      <button
                        onClick={() => handleResetPassword(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-warning hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-warning/[.15] transition-colors disabled:opacity-50"
                        title="Resetear contraseña a 123456"
                      >
                        🔑 Resetear contraseña
                      </button>
                    </Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Información del sistema">
        {infoLoading || !systemInfo ? (
          <SkeletonText lines={4} />
        ) : (
          <>
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

            <div className="flex justify-end pt-3 border-t border-border">
              <Button variant="secondary" onClick={handleCleanupLoginAttempts} disabled={loginAttemptCleanupLoading}>
                {loginAttemptCleanupLoading ? "Calculando…" : "🗑️ Limpiar intentos de login expirados"}
              </Button>
            </div>
          </>
        )}
      </SectionCard>

      <EngineDiagnosticsSection />

      <DataQualitySection />

      <SectionCard title="Configuración de Carga Laboral">
        {hoursLoading || hoursPerDay === null ? (
          <SkeletonText lines={4} />
        ) : (
          <>
            <p className="text-xs text-secondary">
              4 límites definen los 5 rangos del semáforo de carga laboral. Cada uno se guarda por separado y debe
              mantener el orden: Subutilización &lt; Moderado/Óptimo &lt; Óptimo/Elevada &lt; Elevada/Sobrecarga.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Límite Subutilización / Moderado</label>
                <p className="text-xs text-secondary">Por debajo de este valor: Subutilización.</p>
                <input
                  type="text"
                  inputMode="decimal"
                  value={limitLowInput}
                  onChange={(e) => setLimitLowInput(e.target.value)}
                  placeholder="ej: 5.30"
                  className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Límite Rendimiento moderado / Rango óptimo</label>
                <p className="text-xs text-secondary">
                  Por encima de este valor comienza el Rango óptimo. También define las horas de trabajo efectivo
                  por día (base para el cálculo semanal y mensual).
                </p>
                <input
                  type="text"
                  inputMode="decimal"
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                  placeholder="ej: 6.30 = 6h 30min"
                  className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Límite Óptimo / Carga elevada</label>
                <p className="text-xs text-secondary">Por encima de este valor: Carga elevada.</p>
                <input
                  type="text"
                  inputMode="decimal"
                  value={limitHighInput}
                  onChange={(e) => setLimitHighInput(e.target.value)}
                  placeholder="ej: 7.30"
                  className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Límite Carga elevada / Sobrecarga</label>
                <p className="text-xs text-secondary">Por encima de este valor: Sobrecarga.</p>
                <input
                  type="text"
                  inputMode="decimal"
                  value={limitOverloadInput}
                  onChange={(e) => setLimitOverloadInput(e.target.value)}
                  placeholder="ej: 8.30"
                  className="w-32 border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {(() => {
              if (
                !validateDisplayHours(hoursInput) ||
                !validateDisplayHours(limitLowInput) ||
                !validateDisplayHours(limitHighInput) ||
                !validateDisplayHours(limitOverloadInput)
              )
                return null;
              const preview = displayToHours(hoursInput);
              const lowPreview = displayToHours(limitLowInput);
              const highPreview = displayToHours(limitHighInput);
              const overloadPreview = displayToHours(limitOverloadInput);
              if (preview < 4 || preview > 8) return null;
              if (!(lowPreview < preview && preview <= highPreview && highPreview < overloadPreview)) {
                return (
                  <div className="rounded-lg bg-danger/[.09] border border-danger/30 px-4 py-3 text-sm text-danger">
                    Los límites deben cumplir: Subutilización &lt; Horas efectivas ≤ Óptimo &lt; Sobrecarga.
                  </div>
                );
              }
              const now = new Date();
              const bizDays = businessDaysInMonth(now.getFullYear(), now.getMonth() + 1);
              const monthLabel = now.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
              return (
                <div className="rounded-lg bg-background border border-border px-4 py-3 space-y-1.5 text-sm text-secondary">
                  <p className="font-medium text-title">Rangos resultantes:</p>
                  <p>🔴 Subutilización: menos de <span className="font-medium text-title">{hoursToDisplay(lowPreview)}</span></p>
                  <p>🟡 Rendimiento moderado: de <span className="font-medium text-title">{hoursToDisplay(lowPreview)}</span> a <span className="font-medium text-title">{hoursToDisplay(preview)}</span></p>
                  <p>🟢 Rango óptimo: de <span className="font-medium text-title">{hoursToDisplay(preview)}</span> a <span className="font-medium text-title">{hoursToDisplay(highPreview)}</span></p>
                  <p>🟠 Carga elevada: de <span className="font-medium text-title">{hoursToDisplay(highPreview)}</span> a <span className="font-medium text-title">{hoursToDisplay(overloadPreview)}</span></p>
                  <p>🔴 Sobrecarga: más de <span className="font-medium text-title">{hoursToDisplay(overloadPreview)}</span></p>
                  <p className="pt-1.5 border-t border-border">Horas semanales: <span className="font-medium text-title">{hoursToDisplay(preview * 5)} horas</span> (5 días × {hoursToDisplay(preview)}h)</p>
                  <p>
                    Horas mensuales: varía según días laborables (ej: {monthLabel} = {bizDays} días ×{" "}
                    {hoursToDisplay(preview)}h = <span className="font-medium text-title">{hoursToDisplay(preview * bizDays)} horas</span>)
                  </p>
                </div>
              );
            })()}

            <Button
              onClick={handleSaveHours}
              disabled={
                hoursSaving ||
                (validateDisplayHours(hoursInput) &&
                  validateDisplayHours(limitLowInput) &&
                  validateDisplayHours(limitHighInput) &&
                  validateDisplayHours(limitOverloadInput) &&
                  displayToHours(hoursInput) === hoursPerDay &&
                  displayToHours(limitLowInput) === workloadLimitLow &&
                  displayToHours(limitHighInput) === workloadLimitHigh &&
                  displayToHours(limitOverloadInput) === workloadLimitOverload)
              }
            >
              {hoursSaving ? "Guardando…" : "Guardar configuración"}
            </Button>
          </>
        )}
      </SectionCard>

      <WelcomeMessageSection />

      <NotificationRulesSection />

      <ActivityReasonsSection />

      <HolidaysSection />

      <LeaveRecordsSection users={users} />

      <SpecialStatusSection users={users} />

      <KpiStartDateSection />

      <AnalyticsConfigSection />
      <PredictionWindowSection />
      <NormalizationCurvesSection />
      <RoleTargetsSection />

      <DocumentationSection />

      <SectionCard title="Solicitudes de titulares">
        <p className="text-xs text-secondary">
          Solicitudes de acceso, rectificación y eliminación enviadas por los usuarios desde su perfil.
        </p>
        <div className="rounded-lg border border-border overflow-hidden">
          {dataRequestsLoading ? (
            <div>
              <SkeletonRow columns={5} />
              <SkeletonRow columns={5} />
              <SkeletonRow columns={5} />
            </div>
          ) : dataRequests.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Sin solicitudes registradas" description="No hay solicitudes de titulares registradas." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <Th>Usuario</Th>
                  <Th>Tipo</Th>
                  <Th>Fecha</Th>
                  <Th>Estado</Th>
                  <Th className="text-right">Acción</Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {dataRequests.map((r) => (
                  <TableRow key={r.id}>
                    <Td className="text-title font-medium">
                      {r.user.name}
                      <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[r.user.role]}</span>
                      {r.description && (
                        <span className="block text-xs text-secondary mt-0.5 max-w-xs truncate" title={r.description}>
                          {r.description}
                        </span>
                      )}
                    </Td>
                    <Td className="text-secondary">{REQUEST_TYPE_LABEL[r.type]}</Td>
                    <Td className="text-secondary">{formatDate(r.createdAt)}</Td>
                    <Td>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${REQUEST_STATUS_CLASS[r.status]}`}>
                        {REQUEST_STATUS_LABEL[r.status]}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {r.status !== "RESUELTA" ? (
                        <button
                          onClick={() => handleUpdateRequestStatus(r, "RESUELTA")}
                          disabled={dataRequestBusyId === r.id}
                          className="text-xs text-success hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-success/[.13] transition-colors disabled:opacity-50"
                        >
                          ✓ Marcar resuelta
                        </button>
                      ) : (
                        <span className="text-xs text-disabled">
                          {r.resolver ? `Resuelta por ${r.resolver.name}` : "Resuelta"}
                        </span>
                      )}
                    </Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Política de retención de datos">
        {retentionLoading || !retentionPolicy ? (
          <SkeletonText lines={3} />
        ) : (
          <>
            <p className="text-xs text-secondary">
              Define por cuánto tiempo se conservan los informes mensuales, las tareas archivadas y los documentos
              de la base de conocimiento de Nova antes de poder depurarlos.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Retener informes mensuales por</label>
                <select
                  value={retentionPolicy.monthlyReportsMonths}
                  onChange={(e) =>
                    setRetentionPolicy({ ...retentionPolicy, monthlyReportsMonths: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {MONTHLY_REPORTS_OPTIONS.map((v) => (
                    <option key={v} value={v}>{monthsLabel(v)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Retener tareas archivadas por</label>
                <select
                  value={retentionPolicy.archivedTasksMonths}
                  onChange={(e) =>
                    setRetentionPolicy({ ...retentionPolicy, archivedTasksMonths: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {ARCHIVED_TASKS_OPTIONS.map((v) => (
                    <option key={v} value={v}>{monthsLabel(v)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-title">Retener documentos de Nova por</label>
                <select
                  value={retentionPolicy.knowledgeDocsMonths}
                  onChange={(e) =>
                    setRetentionPolicy({ ...retentionPolicy, knowledgeDocsMonths: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {KNOWLEDGE_DOCS_OPTIONS.map((v) => (
                    <option key={v} value={v}>{monthsLabel(v)}</option>
                  ))}
                </select>
              </div>
            </div>

            <Button onClick={handleSaveRetentionPolicy} disabled={retentionSaving}>
              {retentionSaving ? "Guardando…" : "Guardar política"}
            </Button>

            <div className="pt-4 border-t border-border space-y-3">
              <p className="text-xs text-secondary">
                Elimina permanentemente los registros que superen la política vigente. Se pedirá confirmación
                y quedará constancia de quién ejecutó la depuración y cuántos registros se eliminaron.
              </p>
              <Button variant="destructive" onClick={handleRunPurge} disabled={purgeLoading}>
                {purgeLoading ? "Calculando…" : "🗑️ Ejecutar depuración ahora"}
              </Button>
            </div>
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
      )}
    </div>
  );
}
