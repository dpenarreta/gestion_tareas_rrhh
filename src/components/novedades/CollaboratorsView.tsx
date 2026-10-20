"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, novedadesApi } from "./api";
import { ErrorBox, Label, SelectInput, TextArea, TextInput } from "./fields";
import { PERM, STATUS_LABEL, type Collaborator, type CollaboratorStatus } from "./types";
import type { ModuleContext } from "./NovedadesModule";
import StatusChangeDialog from "./StatusChangeDialog";
import ImportDialog from "./ImportDialog";
import { CedulaDialog, WorkedDaysRemovalDialog } from "./CollaboratorAdminDialogs";

type History = {
  statuses: { previousStatus: CollaboratorStatus; newStatus: CollaboratorStatus; changedBy: string; reason: string; createdAt: string }[];
  assignments: { supervisor: string; startedAt: string; endedAt: string | null; assignedBy: string; reason: string }[];
};

const STATUS_VARIANT: Record<CollaboratorStatus, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  INACTIVE: "neutral",
};

export default function CollaboratorsView({ ctx }: { ctx: ModuleContext }) {
  const [items, setItems] = useState<Collaborator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Collaborator | "new" | null>(null);
  const [statusTarget, setStatusTarget] = useState<Collaborator | null>(null);
  const [history, setHistory] = useState<{ collaborator: Collaborator; data: History } | null>(null);
  const [reassigning, setReassigning] = useState<Collaborator | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [removing, setRemoving] = useState<Collaborator | null>(null);
  // Administrador: retirar/restaurar en Días laborados y corregir cédula.
  const [adminAction, setAdminAction] = useState<{ kind: "remove" | "restore" | "cedula"; collaborator: Collaborator } | null>(null);

  const canManage = ctx.can(PERM.colaboradores) && !ctx.me.isAssistant;

  const load = useCallback(async () => {
    const result = await novedadesApi.get<Collaborator[]>("collaborators", {
      q: search,
      status,
      supervisor: ctx.supervisorId ?? undefined,
    });
    if (result.ok) {
      setItems(result.data);
      setError(null);
    } else {
      setItems([]);
      setError(result.error);
    }
  }, [search, status, ctx.supervisorId]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function openHistory(c: Collaborator) {
    const result = await novedadesApi.get<History>(`collaborators/${c.id}/history`);
    if (result.ok) setHistory({ collaborator: c, data: result.data });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-2 items-end">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar cédula o nombre…" className="w-64" />
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">Todos los estados</option>
            {(Object.keys(STATUS_LABEL) as CollaboratorStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </SelectInput>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => novedadesApi.download("collaborators/template", {}, "plantilla-base-colaboradores.xlsx")}
            >
              <Download className="w-4 h-4" /> Plantilla
            </Button>
            {ctx.can(PERM.importar) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setImportOpen(true)}
                disabled={ctx.me.nationalWrite && ctx.supervisorId === null}
                title={ctx.me.nationalWrite && ctx.supervisorId === null ? "Seleccione arriba el supervisor de destino" : undefined}
              >
                <Upload className="w-4 h-4" /> Importar base
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="w-4 h-4" /> Agregar colaborador
            </Button>
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      {items === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : (
        <div className="overflow-auto max-h-[62vh] border border-border rounded-xl bg-surface">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {["Cédula", "Nombres completos", "Regional", "Área", "Cargo", "Supervisor", "Estado", ""].map((h) => (
                  <th key={h} className="sticky top-0 bg-surface2 border-b border-border px-3 py-2 text-left text-xs font-semibold text-secondary">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-secondary py-10">
                    No hay colaboradores registrados.
                  </td>
                </tr>
              )}
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-surface2/60">
                  <td className="border-b border-border px-3 py-2 font-mono text-xs">{c.cedula}</td>
                  <td className="border-b border-border px-3 py-2">{c.fullName}</td>
                  <td className="border-b border-border px-3 py-2">{c.regional}</td>
                  <td className="border-b border-border px-3 py-2">{c.area}</td>
                  <td className="border-b border-border px-3 py-2">{c.cargo}</td>
                  <td className="border-b border-border px-3 py-2 text-secondary">{c.supervisorName}</td>
                  <td className="border-b border-border px-3 py-2">
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    {c.workedDaysRemovedAt && (
                      <Badge
                        variant="neutral"
                        className="ml-1"
                        title={`Retirado por ${c.workedDaysRemovedBy || "el Administrador"} el ${formatDateTime(c.workedDaysRemovedAt)}${c.workedDaysRemovedReason ? ` · ${c.workedDaysRemovedReason}` : ""}`}
                      >
                        Retirado de Días laborados
                      </Badge>
                    )}
                  </td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap text-right space-x-2">
                    <button className="text-xs text-primary hover:underline" onClick={() => openHistory(c)}>
                      Historial
                    </button>
                    {canManage && (
                      <>
                        <button className="text-xs text-primary hover:underline" onClick={() => setEditing(c)}>
                          Editar
                        </button>
                        <button className="text-xs text-primary hover:underline" onClick={() => setStatusTarget(c)}>
                          Estado
                        </button>
                      </>
                    )}
                    {ctx.me.nationalWrite && (
                      <button className="text-xs text-primary hover:underline" onClick={() => setReassigning(c)}>
                        Reasignar
                      </button>
                    )}
                    {ctx.me.nationalWrite && canManage && (
                      <>
                        <button className="text-xs text-primary hover:underline" onClick={() => setAdminAction({ kind: "cedula", collaborator: c })}>
                          Cédula
                        </button>
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setAdminAction({ kind: c.workedDaysRemovedAt ? "restore" : "remove", collaborator: c })}
                        >
                          {c.workedDaysRemovedAt ? "Restaurar en Días laborados" : "Retirar de Días laborados"}
                        </button>
                        <button className="text-xs text-danger hover:underline" onClick={() => setRemoving(c)}>
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CollaboratorForm
          ctx={ctx}
          collaborator={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          kind="COLLABORATORS"
          supervisorId={ctx.me.isSupervisor && !ctx.me.nationalWrite ? ctx.me.user.id : ctx.supervisorId}
          supervisorName={
            ctx.me.isSupervisor && !ctx.me.nationalWrite
              ? ctx.me.user.name
              : ctx.supervisors.find((s) => s.id === ctx.supervisorId)?.name
          }
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            load();
          }}
        />
      )}
      {adminAction && adminAction.kind !== "cedula" && (
        <WorkedDaysRemovalDialog
          collaborator={adminAction.collaborator}
          restore={adminAction.kind === "restore"}
          onClose={() => setAdminAction(null)}
          onDone={() => {
            setAdminAction(null);
            load();
          }}
        />
      )}
      {adminAction?.kind === "cedula" && (
        <CedulaDialog
          collaborator={adminAction.collaborator}
          onClose={() => setAdminAction(null)}
          onDone={() => {
            setAdminAction(null);
            load();
          }}
        />
      )}
      {removing && (
        <DeleteCollaboratorDialog
          collaborator={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            load();
          }}
        />
      )}
      {statusTarget && (
        <StatusChangeDialog
          collaborator={statusTarget}
          onClose={() => setStatusTarget(null)}
          onDone={() => {
            setStatusTarget(null);
            load();
          }}
        />
      )}
      {reassigning && (
        <ReassignDialog
          ctx={ctx}
          collaborator={reassigning}
          onClose={() => setReassigning(null)}
          onDone={() => {
            setReassigning(null);
            load();
          }}
        />
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} variant="drawer">
          <ModalHeader title={`Historial · ${history.collaborator.fullName}`} onClose={() => setHistory(null)} />
          <div className="p-5 space-y-5 text-sm">
            <section>
              <h3 className="font-semibold text-title mb-2">Estados operativos</h3>
              {history.data.statuses.length === 0 && <p className="text-secondary">Sin cambios de estado.</p>}
              <ul className="space-y-2">
                {history.data.statuses.map((s, i) => (
                  <li key={i} className="border border-border rounded-lg p-2">
                    {STATUS_LABEL[s.previousStatus]} → <strong>{STATUS_LABEL[s.newStatus]}</strong> · {s.changedBy} ·{" "}
                    {formatDateTime(s.createdAt)}
                    {s.reason && <div className="text-secondary text-xs mt-1">Motivo: {s.reason}</div>}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="font-semibold text-title mb-2">Asignaciones</h3>
              <ul className="space-y-2">
                {history.data.assignments.map((a, i) => (
                  <li key={i} className="border border-border rounded-lg p-2">
                    <strong>{a.supervisor}</strong> · desde {formatDateTime(a.startedAt)}
                    {a.endedAt ? ` hasta ${formatDateTime(a.endedAt)}` : " (vigente)"}
                    <div className="text-secondary text-xs mt-1">
                      Asignado por {a.assignedBy}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CollaboratorForm({
  ctx,
  collaborator,
  onClose,
  onSaved,
}: {
  ctx: ModuleContext;
  collaborator: Collaborator | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [values, setValues] = useState({
    cedula: collaborator?.cedula ?? "",
    fullName: collaborator?.fullName ?? "",
    regional: collaborator?.regional ?? "",
    area: collaborator?.area ?? "",
    cargo: collaborator?.cargo ?? "",
  });
  const [supervisorId, setSupervisorId] = useState<number | "">(ctx.supervisorId ?? ctx.supervisors[0]?.id ?? "");
  // Solo en el alta: marca un ingreso REAL (no la carga de alguien que ya
  // trabajaba). Dispara el correo de ingreso al registrar su segundo día.
  const [isNewHire, setIsNewHire] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pickSupervisor = !collaborator && ctx.me.nationalWrite;
  // Corrección de cédula de un colaborador ya registrado: solo el
  // Administrador, con motivo; va por su propio endpoint auditado.
  const canFixCedula = Boolean(collaborator) && ctx.me.nationalWrite && ctx.can(PERM.colaboradores);
  const cedulaChanged = Boolean(collaborator) && values.cedula.trim() !== collaborator?.cedula;
  const [cedulaReason, setCedulaReason] = useState("");

  async function submit() {
    setSaving(true);
    setError(null);
    if (collaborator && cedulaChanged) {
      const fixed = await novedadesApi.post(`collaborators/${collaborator.id}/cedula`, {
        cedula: values.cedula,
        reason: cedulaReason,
      });
      if (!fixed.ok) {
        setSaving(false);
        setError(fixed.error); // no se guardó nada: corrija y vuelva a intentar
        return;
      }
    }
    const result = collaborator
      ? await novedadesApi.patch(`collaborators/${collaborator.id}`, {
          fullName: values.fullName,
          regional: values.regional,
          area: values.area,
          cargo: values.cargo,
        })
      : await novedadesApi.post("collaborators", {
          ...values,
          supervisorId: pickSupervisor ? supervisorId || null : null,
          isNewHire,
        });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(collaborator ? "Colaborador actualizado." : "Colaborador registrado. Se notificó al Administrador.", "success");
    onSaved();
  }

  const field = (key: keyof typeof values, label: string, disabled = false) => (
    <label key={key}>
      <Label>{label}</Label>
      <TextInput
        value={values[key]}
        disabled={disabled}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title={collaborator ? "Editar colaborador" : "Agregar colaborador"} onClose={onClose} />
      <div className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {field("cedula", "Cédula", Boolean(collaborator) && !canFixCedula)}
          {field("fullName", "Nombres completos")}
          {field("regional", "Regional")}
          {field("area", "Área")}
          {field("cargo", "Cargo")}
          {pickSupervisor && (
            <label>
              <Label>Supervisor responsable</Label>
              <SelectInput value={supervisorId} onChange={(e) => setSupervisorId(e.target.value ? Number(e.target.value) : "")}>
                {ctx.supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </label>
          )}
        </div>
        {cedulaChanged && (
          <label className="block">
            <Label hint="obligatorio">Motivo de la corrección de cédula</Label>
            <TextArea value={cedulaReason} onChange={(e) => setCedulaReason(e.target.value)} maxLength={500} />
          </label>
        )}
        {!collaborator && (
          <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5" checked={isNewHire} onChange={(e) => setIsNewHire(e.target.checked)} />
            <span>
              <span className="font-medium text-title">Es un nuevo ingreso</span>
              <span className="block text-xs text-secondary">
                Márquelo solo si la persona recién ingresa a la operación (no al registrar a alguien que ya trabajaba).
                Se enviará la notificación de ingreso cuando tenga su segundo día laborado registrado.
              </span>
            </span>
          </label>
        )}
        {!collaborator && (
          <p className="text-xs text-secondary">
            El registro es inmediato (no requiere aprobación) y queda disponible en Días laborados y Horas extras. No
            crea contrato, nómina ni afiliación al IESS.
          </p>
        )}
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={!values.cedula.trim() || !values.fullName.trim() || (cedulaChanged && !cedulaReason.trim())}
          >
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReassignDialog({
  ctx,
  collaborator,
  onClose,
  onDone,
}: {
  ctx: ModuleContext;
  collaborator: Collaborator;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const options = ctx.supervisors.filter((s) => s.id !== collaborator.supervisorId);
  const [supervisorId, setSupervisorId] = useState<number | "">(options[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Reasignar colaborador" onClose={onClose} />
      <div className="p-5 space-y-3">
        <p className="text-sm text-secondary">
          {collaborator.fullName} · supervisor actual: {collaborator.supervisorName}. Los registros históricos conservan
          al supervisor que era responsable cuando se registraron.
        </p>
        <label className="block">
          <Label>Nuevo supervisor</Label>
          <SelectInput value={supervisorId} onChange={(e) => setSupervisorId(e.target.value ? Number(e.target.value) : "")}>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="block">
          <Label hint="obligatorio">Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            loading={saving}
            disabled={!supervisorId || !reason.trim()}
            onClick={async () => {
              setSaving(true);
              const result = await novedadesApi.post(`collaborators/${collaborator.id}/reassign`, { supervisorId, reason });
              setSaving(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              showToast("Colaborador reasignado.", "success");
              onDone();
            }}
          >
            Reasignar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Eliminar a una persona de la BASE OFICIAL (solo Administrador). Es una acción
// distinta a eliminar un registro de horas extras: Django la rechaza si la
// persona ya tiene novedades registradas (se conserva la historia y lo que
// corresponde es pasarla a Inactivo).
function DeleteCollaboratorDialog({
  collaborator,
  onClose,
  onDone,
}: {
  collaborator: Collaborator;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const result = await novedadesApi.del(`collaborators/${collaborator.id}`, { reason: reason.trim() });
    setSaving(false);
    inFlight.current = false;
    if (result.ok) {
      showToast("Colaborador eliminado de la base oficial.", "success");
      onDone();
    } else if (result.status === 404) {
      showToast("El colaborador ya no estaba en la base.", "info");
      onDone();
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} size="sm">
      <ModalHeader title="Eliminar colaborador de la base oficial" onClose={onClose} />
      <div className="p-5 space-y-3">
        <p className="text-sm">
          <strong>{collaborator.fullName}</strong> · cédula <span className="font-mono">{collaborator.cedula}</span> ·
          supervisor {collaborator.supervisorName}
        </p>
        <p className="text-sm text-secondary">
          Esto quita a la persona de la base oficial (no es lo mismo que eliminar un registro de horas extras). Solo se
          permite si no tiene días laborados ni horas extras registrados; si los tiene, cambie su estado a Inactivo. Queda
          en el historial y se alerta a los administradores.
        </p>
        <label className="block">
          <Label hint="obligatorio">Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" loading={saving} disabled={saving || !reason.trim()} onClick={confirm}>
            Eliminar de la base
          </Button>
        </div>
      </div>
    </Modal>
  );
}
