"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

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

/**
 * Política de retención de datos (LOPDP) + purga manual — extraído 1:1 de
 * SettingsManager.tsx (Sprint O), sin cambios de lógica.
 */
export default function RetentionPolicySection() {
  const { showToast } = useToast();
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

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
    queueMicrotask(loadRetentionPolicy);
  }, [loadRetentionPolicy]);

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

  return (
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
  );
}
