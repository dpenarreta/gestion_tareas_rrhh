"use client";

import { useState, useEffect, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import { hoursToDisplay, displayToHours, validateDisplayHours, INVALID_HOURS_MESSAGE } from "@/lib/timeFormat";
import { ROLE_LABEL, ALL_ROLES } from "@/lib/roles";
import { TARGET_TIME_REASON_OPTIONS, TARGET_TIME_REASON_LABEL, type TargetTimeAdjustReason } from "@/lib/targetTime";
import ValidateTargetTimeModal from "./ValidateTargetTimeModal";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

type PendingTask = {
  id: string;
  title: string;
  status: string;
  type: "FIJA" | "SEGUIMIENTO";
  priority: string;
  estimatedHours: number;
  realHours: number;
  endDate: string;
  archivedMonth: string | null;
  assignedTo: { id: string; name: string; role: Role };
};

type DataQuality = { validatedCount: number; pendingCount: number; totalCount: number; validatedPct: number; pendingPct: number };

type AssignableUser = { id: string; name: string; email: string; role: string };

const TYPE_LABEL: Record<string, string> = { FIJA: "Fija", SEGUIMIENTO: "Seguimiento" };

const selectClass =
  "border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary";

function BulkValidateModal({ taskIds, onClose, onDone }: { taskIds: string[]; onClose: () => void; onDone: (skipped: string[]) => void }) {
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState<TargetTimeAdjustReason>("PROCEDIMIENTO_ESTANDAR");
  const [reasonDetail, setReasonDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (submitting) return;
    if (!newValue || !validateDisplayHours(newValue)) {
      setError(INVALID_HOURS_MESSAGE);
      return;
    }
    if (reason === "OTRO" && !reasonDetail.trim()) {
      setError('Indica el detalle del motivo cuando eliges "Otro"');
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks/target-time/bulk-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskIds,
          newValue: displayToHours(newValue),
          reason,
          reasonDetail: reason === "OTRO" ? reasonDetail.trim() : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onDone(data.skippedSelfAssigned ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Error al regularizar");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-[14px] shadow-2xl p-5">
        <h3 className="text-sm font-semibold text-title uppercase tracking-wider mb-1">Regularizar {taskIds.length} tareas</h3>
        <p className="text-xs text-secondary mb-4">
          Se aplicará el mismo Tiempo Objetivo y motivo a todas las tareas seleccionadas. Cada una queda auditada individualmente.
        </p>
        <div className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Nuevo tiempo objetivo (HH.MM) *</label>
            <input
              type="text"
              inputMode="decimal"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="ej: 6.30 = 6h 30min"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Motivo del ajuste *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value as TargetTimeAdjustReason)} className={`w-full ${selectClass}`}>
              {TARGET_TIME_REASON_OPTIONS.map((r) => (
                <option key={r} value={r}>{TARGET_TIME_REASON_LABEL[r]}</option>
              ))}
            </select>
          </div>
          {reason === "OTRO" && (
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Detalle del motivo *</label>
              <textarea
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                rows={2}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          )}
          {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Guardando…" : `Regularizar ${taskIds.length}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Herramienta "Regularizar tiempos objetivo" (§Sprint 6 S6-D) — solo
 * Administrador y Jefe Nacional. Lista tareas activas/recientes sin Tiempo
 * Objetivo validado, con filtros y edición individual/masiva. NUNCA
 * recalcula automáticamente desde horas reales — la decisión siempre es
 * humana (ver /api/tasks/target-time/pending, /bulk-validate).
 */
export default function RegularizeTargetTimeManager({ currentUserId }: { currentUserId: string }) {
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQuality | null>(null);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingTask, setEditingTask] = useState<PendingTask | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (userFilter) params.set("userId", userFilter);
    if (roleFilter) params.set("role", roleFilter);
    if (typeFilter) params.set("type", typeFilter);
    const res = await fetch(`/api/tasks/target-time/pending?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks);
      setDataQuality(data.dataQuality);
      setSelected(new Set());
    }
    setLoading(false);
  }, [userFilter, roleFilter, typeFilter]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  useEffect(() => {
    queueMicrotask(() => {
      fetch("/api/users/assignable")
        .then((r) => (r.ok ? r.json() : []))
        .then(setUsers)
        .catch(() => setUsers([]));
    });
  }, []);

  const selectableTasks = tasks.filter((t) => t.assignedTo.id !== currentUserId);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === selectableTasks.length ? new Set() : new Set(selectableTasks.map((t) => t.id))));
  }

  return (
    <div className="space-y-5">
      {dataQuality && (
        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-8 flex-wrap">
          <div>
            <p className="text-[11px] text-disabled uppercase tracking-wider">Tiempo objetivo validado</p>
            <p className="text-xl font-bold text-success">{dataQuality.validatedPct}%</p>
          </div>
          <div>
            <p className="text-[11px] text-disabled uppercase tracking-wider">Pendiente de validar</p>
            <p className="text-xl font-bold text-warning">{dataQuality.pendingPct}%</p>
          </div>
          <p className="text-xs text-disabled ml-auto">{dataQuality.totalCount} tareas activas/recientes evaluadas</p>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between bg-success/[.1] text-success text-sm px-4 py-2.5 rounded-xl">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="ml-2 font-bold">×</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[11px] font-semibold text-secondary mb-1">Colaborador</label>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={selectClass}>
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-secondary mb-1">Cargo</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={selectClass}>
            <option value="">Todos</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-secondary mb-1">Tipo</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectClass}>
            <option value="">Todos</option>
            <option value="FIJA">Fija</option>
            <option value="SEGUIMIENTO">Seguimiento</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-primary-surface border border-primary/20 rounded-xl px-4 py-2.5">
          <span className="text-sm text-primary font-medium">{selected.size} {selected.size === 1 ? "seleccionada" : "seleccionadas"}</span>
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            Regularizar seleccionadas
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface">
        <Table>
          <TableHead>
            <tr className="border-b border-border">
              <Th>
                <input
                  type="checkbox"
                  checked={selectableTasks.length > 0 && selected.size === selectableTasks.length}
                  onChange={toggleSelectAll}
                  disabled={selectableTasks.length === 0}
                />
              </Th>
              <Th>Tarea</Th>
              <Th>Responsable</Th>
              <Th>Tipo</Th>
              <Th className="text-right">Tiempo objetivo inicial</Th>
              <Th className="text-right">Horas reales</Th>
              <Th className="text-right">Acción</Th>
            </tr>
          </TableHead>
          <TableBody>
            {loading && (
              <>
                {Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <Td colSpan={7} className="p-0">
                      <SkeletonRow columns={7} />
                    </Td>
                  </TableRow>
                ))}
              </>
            )}
            {!loading && tasks.length === 0 && (
              <TableRow>
                <Td colSpan={7} className="p-0">
                  <EmptyState
                    title="Sin tareas pendientes"
                    description="No hay tareas pendientes de validar con estos filtros."
                  />
                </Td>
              </TableRow>
            )}
            {!loading && tasks.map((t) => {
              const isSelf = t.assignedTo.id === currentUserId;
              return (
                <TableRow key={t.id}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      disabled={isSelf}
                      title={isSelf ? "No puedes validar el tiempo objetivo de tus propias tareas" : undefined}
                    />
                  </Td>
                  <Td className="max-w-[260px] truncate text-title">{t.title}</Td>
                  <Td className="whitespace-nowrap">
                    {t.assignedTo.name} <span className="text-disabled text-xs">({ROLE_LABEL[t.assignedTo.role]})</span>
                  </Td>
                  <Td>{TYPE_LABEL[t.type]}</Td>
                  <Td className="text-right">{hoursToDisplay(t.estimatedHours)}h</Td>
                  <Td className="text-right">{hoursToDisplay(t.realHours)}h</Td>
                  <Td className="text-right">
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => setEditingTask(t)}
                      disabled={isSelf}
                      title={isSelf ? "No puedes validar el tiempo objetivo de tus propias tareas" : undefined}
                    >
                      Validar
                    </Button>
                  </Td>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editingTask && (
        <ValidateTargetTimeModal
          taskId={editingTask.id}
          taskTitle={editingTask.title}
          currentValue={editingTask.estimatedHours}
          onClose={() => setEditingTask(null)}
          onValidated={() => {
            setEditingTask(null);
            setNotice("Tiempo objetivo validado correctamente.");
            load();
          }}
        />
      )}

      {bulkOpen && (
        <BulkValidateModal
          taskIds={[...selected]}
          onClose={() => setBulkOpen(false)}
          onDone={(skipped) => {
            setBulkOpen(false);
            setNotice(
              skipped.length > 0
                ? `Regularización aplicada. ${skipped.length} tarea(s) propias se omitieron (no puedes validar tu propio tiempo objetivo).`
                : "Regularización aplicada correctamente."
            );
            load();
          }}
        />
      )}
    </div>
  );
}
