"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, novedadesApi } from "@/components/novedades/api";
import { ErrorBox, Label, SelectInput, TextArea, TextInput } from "@/components/novedades/fields";
import type { NovedadEvent } from "@/components/novedades/types";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import SectionCard from "@/components/settings/SectionCard";

type PermState = "mandatory" | "configurable" | "unavailable";
type RoleConfig = {
  role: Role;
  permissions: { codename: string; label: string; state: PermState; enabled: boolean }[];
  lastChange: { by: string; at: string; detail: string } | null;
};
type OperationalUser = { id: number; name: string; email: string; role: Role; isActive: boolean };
type Override = {
  id: number;
  userId: number;
  userName: string;
  codename: string;
  effect: "GRANT" | "DENY";
  reason: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string;
  revokeReason: string;
};
type Effective = {
  user: { id: number; name: string; role: Role | null };
  effective: { permissions: string[]; nationalRead: boolean; nationalWrite: boolean };
};

const STATE_BADGE: Record<PermState, { label: string; variant: "info" | "neutral" | "success" }> = {
  mandatory: { label: "Obligatorio", variant: "success" },
  configurable: { label: "Configurable", variant: "info" },
  unavailable: { label: "No disponible", variant: "neutral" },
};

// Permisos del módulo Control Operativo de Novedades. Todo lo que aquí se
// cambia lo valida y audita Django (apps/novedades/access.py): esta pantalla
// solo ofrece como interruptor lo que la matriz de roles declara
// "configurable" — las restricciones obligatorias (ámbito por supervisor,
// Asistente de solo lectura, períodos cerrados) no aparecen como opción.
export default function NovedadesPermissionsSection() {
  const { showToast } = useToast();
  const [roles, setRoles] = useState<RoleConfig[] | null>(null);
  const [users, setUsers] = useState<OperationalUser[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [history, setHistory] = useState<NovedadEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toggle, setToggle] = useState<{ role: Role; codename: string; label: string; enabled: boolean } | null>(null);
  const [newOverride, setNewOverride] = useState(false);
  const [revoking, setRevoking] = useState<Override | null>(null);
  const [effectiveUser, setEffectiveUser] = useState<number | "">("");
  const [effective, setEffective] = useState<Effective | null>(null);

  const load = useCallback(async () => {
    const [config, usersRes, overridesRes, historyRes] = await Promise.all([
      novedadesApi.get<{ roles: RoleConfig[] }>("permissions/config"),
      novedadesApi.get<OperationalUser[]>("permissions/users"),
      novedadesApi.get<Override[]>("permissions/overrides"),
      novedadesApi.get<{ results: NovedadEvent[] }>("history", { kind: "permissions", limit: 50 }),
    ]);
    if (!config.ok) {
      setError(config.error);
      setRoles([]);
      return;
    }
    setRoles(config.data.roles);
    if (usersRes.ok) setUsers(usersRes.data);
    if (overridesRes.ok) setOverrides(overridesRes.data);
    if (historyRes.ok) setHistory(historyRes.data.results);
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  useEffect(() => {
    if (!effectiveUser) return;
    novedadesApi.get<Effective>(`permissions/effective/${effectiveUser}`).then((r) => r.ok && setEffective(r.data));
  }, [effectiveUser, overrides, roles]);

  const labels = useMemo(
    () => Object.fromEntries((roles ?? []).flatMap((r) => r.permissions.map((p) => [p.codename, p.label]))),
    [roles],
  );

  return (
    <SectionCard title="Permisos del módulo Control Operativo de Novedades">
      {roles === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-primary" />
        </div>
      ) : (
    <div className="space-y-6">
      <ErrorBox message={error} />
      <p className="text-xs text-secondary">
        Siempre obligatorias (no configurables): cada supervisor solo ve y modifica su propio equipo; el Asistente de
        Operaciones nunca modifica registros originales; los períodos cerrados no admiten edición ordinaria; nadie
        puede otorgarse permisos a sí mismo. Habilitar una facultad nunca amplía el ámbito de datos.
      </p>

      <OvertimeGraceSetting />

      <div className="grid lg:grid-cols-2 gap-4">
        {roles.map((r) => (
          <div key={r.role} className="border border-border rounded-xl">
            <div className="px-4 py-3 border-b border-border">
              <h4 className="font-semibold text-title">{ROLE_LABEL[r.role] ?? r.role}</h4>
              <p className="text-xs text-secondary">
                {r.lastChange
                  ? `Último cambio: ${r.lastChange.by} · ${formatDateTime(r.lastChange.at)}`
                  : "Sin cambios desde la configuración inicial"}
              </p>
            </div>
            <ul className="divide-y divide-border">
              {r.permissions.map((p) => (
                <li key={p.codename} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className={p.state === "unavailable" ? "text-secondary" : "text-title"}>{p.label}</div>
                    <Badge variant={STATE_BADGE[p.state].variant} className="mt-0.5">
                      {STATE_BADGE[p.state].label}
                    </Badge>
                  </div>
                  {p.state === "configurable" ? (
                    <button
                      role="switch"
                      aria-checked={p.enabled}
                      aria-label={`${p.label} para ${ROLE_LABEL[r.role]}`}
                      onClick={() => setToggle({ role: r.role, codename: p.codename, label: p.label, enabled: !p.enabled })}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${p.enabled ? "bg-primary" : "bg-border"}`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${p.enabled ? "left-[18px]" : "left-0.5"}`}
                      />
                    </button>
                  ) : (
                    <span className="text-xs text-secondary">{p.enabled ? "Activo" : "—"}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-title text-sm">Excepciones individuales</h4>
          <Button size="sm" onClick={() => setNewOverride(true)} disabled={!users.length}>
            Nueva excepción
          </Button>
        </div>
        {overrides.length === 0 ? (
          <p className="text-sm text-secondary">No hay excepciones individuales.</p>
        ) : (
          <ul className="space-y-2">
            {overrides.map((o) => (
              <li key={o.id} className="border border-border rounded-lg p-3 text-sm flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div>
                    <strong>{o.userName}</strong> ·{" "}
                    <Badge variant={o.effect === "GRANT" ? "success" : "danger"}>{o.effect === "GRANT" ? "Concede" : "Restringe"}</Badge>{" "}
                    {labels[o.codename] ?? o.codename}
                  </div>
                  <div className="text-xs text-secondary mt-1">
                    Motivo: {o.reason} · {o.createdBy} · {formatDateTime(o.createdAt)}
                    {o.revokedAt && ` · Revocada por ${o.revokedBy} (${formatDateTime(o.revokedAt)})${o.revokeReason ? `: ${o.revokeReason}` : ""}`}
                  </div>
                </div>
                {!o.revokedAt && (
                  <Button size="sm" variant="secondary" onClick={() => setRevoking(o)}>
                    Revocar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="font-semibold text-title text-sm">Permisos efectivos por usuario</h4>
        <SelectInput
          value={effectiveUser}
          onChange={(e) => setEffectiveUser(e.target.value ? Number(e.target.value) : "")}
          className="max-w-sm"
        >
          <option value="">Seleccione un usuario…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {ROLE_LABEL[u.role] ?? u.role}
            </option>
          ))}
        </SelectInput>
        {effective && effectiveUser !== "" && (
          <div className="text-sm border border-border rounded-lg p-3 space-y-1">
            <div className="text-xs text-secondary">
              Ámbito: {effective.effective.nationalWrite ? "Nacional (escritura)" : effective.effective.nationalRead ? "Nacional (solo lectura)" : "Solo su equipo"}
            </div>
            <div className="flex flex-wrap gap-1">
              {effective.effective.permissions.length === 0 && <span className="text-secondary">Sin permisos en el módulo.</span>}
              {effective.effective.permissions.map((p) => (
                <Badge key={p} variant="info">
                  {labels[p] ?? p}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="font-semibold text-title text-sm">Historial de cambios de permisos</h4>
        {history.length === 0 ? (
          <p className="text-sm text-secondary">Sin cambios registrados.</p>
        ) : (
          <ul className="text-xs space-y-1 max-h-56 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id}>
                {formatDateTime(h.createdAt)} · <strong>{h.actorName}</strong> · {h.targetLabel} ·{" "}
                {labels[h.field] ?? h.field}: {h.oldValue ? `${h.oldValue} → ` : ""}
                {h.newValue}
                {h.reason ? ` — ${h.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      {toggle && (
        <ReasonDialog
          title={`${toggle.enabled ? "Habilitar" : "Deshabilitar"} para ${ROLE_LABEL[toggle.role]}`}
          message={`“${toggle.label}”. El cambio afecta a todos los usuarios con este rol y se aplica en su siguiente acción, sin cerrar sesión.`}
          reasonRequired={false}
          onClose={() => setToggle(null)}
          onConfirm={async (reason) => {
            const result = await novedadesApi.post("permissions/roles", {
              role: toggle.role,
              codename: toggle.codename,
              enabled: toggle.enabled,
              reason,
            });
            if (!result.ok) return result.error;
            showToast("Permiso actualizado.", "success");
            setToggle(null);
            load();
            return null;
          }}
        />
      )}
      {revoking && (
        <ReasonDialog
          title="Revocar excepción"
          message={`${revoking.userName}: ${labels[revoking.codename] ?? revoking.codename}.`}
          reasonRequired={false}
          onClose={() => setRevoking(null)}
          onConfirm={async (reason) => {
            const result = await novedadesApi.post(`permissions/overrides/${revoking.id}/revoke`, { reason });
            if (!result.ok) return result.error;
            showToast("Excepción revocada.", "success");
            setRevoking(null);
            load();
            return null;
          }}
        />
      )}
      {newOverride && (
        <OverrideDialog
          users={users}
          roles={roles}
          onClose={() => setNewOverride(false)}
          onCreated={() => {
            setNewOverride(false);
            showToast("Excepción registrada.", "success");
            load();
          }}
        />
      )}
    </div>
      )}
    </SectionCard>
  );
}

function ReasonDialog({
  title,
  message,
  reasonRequired,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  reasonRequired: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={title} onClose={onClose} />
      <div className="p-5 space-y-3">
        <p className="text-sm text-secondary">{message}</p>
        <label className="block">
          <Label hint={reasonRequired ? "obligatorio" : "recomendado"}>Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            loading={saving}
            disabled={reasonRequired && !reason.trim()}
            onClick={async () => {
              setSaving(true);
              const err = await onConfirm(reason);
              setSaving(false);
              setError(err);
            }}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OverrideDialog({
  users,
  roles,
  onClose,
  onCreated,
}: {
  users: OperationalUser[];
  roles: RoleConfig[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [userId, setUserId] = useState<number | "">(users[0]?.id ?? "");
  const [codename, setCodename] = useState("");
  const [effect, setEffect] = useState<"GRANT" | "DENY">("GRANT");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const user = users.find((u) => u.id === userId);
  const options = roles.find((r) => r.role === user?.role)?.permissions.filter((p) => p.state === "configurable") ?? [];

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Nueva excepción individual" onClose={onClose} />
      <div className="p-5 space-y-3">
        <label className="block">
          <Label>Usuario</Label>
          <SelectInput
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value ? Number(e.target.value) : "");
              setCodename("");
            }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {ROLE_LABEL[u.role] ?? u.role}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="block">
          <Label>Facultad (solo configurables para su rol)</Label>
          <SelectInput value={codename} onChange={(e) => setCodename(e.target.value)}>
            <option value="">Seleccione…</option>
            {options.map((p) => (
              <option key={p.codename} value={p.codename}>
                {p.label}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="block">
          <Label>Efecto</Label>
          <SelectInput value={effect} onChange={(e) => setEffect(e.target.value as "GRANT" | "DENY")}>
            <option value="GRANT">Conceder</option>
            <option value="DENY">Restringir</option>
          </SelectInput>
        </label>
        <label className="block">
          <Label hint="obligatorio">Motivo</Label>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <p className="text-xs text-secondary">La excepción no amplía el ámbito de datos del usuario y puede revocarse en cualquier momento.</p>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            loading={saving}
            disabled={!userId || !codename || !reason.trim()}
            onClick={async () => {
              setSaving(true);
              const result = await novedadesApi.post("permissions/overrides", { userId, codename, effect, reason });
              setSaving(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              onCreated();
            }}
          >
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Plazo para completar y corregir el mes anterior de Horas extras (48–72 horas
// laborables). El cálculo de la fecha límite vive en Django
// (`OvertimeMonthService.deadline`); aquí solo se edita el número.
function OvertimeGraceSetting() {
  const { showToast } = useToast();
  const [config, setConfig] = useState<{ graceHours: number; minHours: number; maxHours: number } | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    novedadesApi.get<{ graceHours: number; minHours: number; maxHours: number }>("overtime/settings").then((r) => {
      if (!r.ok) return;
      setConfig(r.data);
      setValue(String(r.data.graceHours));
    });
  }, []);

  if (!config) return null;
  const hours = Number(value);
  const valid = Number.isInteger(hours) && hours >= config.minHours && hours <= config.maxHours;

  return (
    <div className="border border-border rounded-xl px-4 py-3 space-y-2">
      <h4 className="font-semibold text-title">Plazo de cierre de Horas extras</h4>
      <p className="text-xs text-secondary">
        Horas extras va por mes calendario (del 1 al último día). Al empezar el mes siguiente, el anterior se puede
        completar y corregir durante este plazo, contado en días hábiles (lunes a viernes sin feriados, 24 horas cada
        uno, hora de Ecuador). No hay cierre automático: al vencer solo se avisa, y el mes se cierra con «Cerrar mes».
        Un cambio aplica a los plazos que todavía no empezaron.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <Label hint={`${config.minHours}–${config.maxHours}`}>Horas laborables</Label>
          <TextInput
            type="number"
            min={config.minHours}
            max={config.maxHours}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28"
            aria-label="Plazo de cierre de Horas extras en horas laborables"
          />
        </label>
        <Button
          size="sm"
          loading={saving}
          disabled={!valid || hours === config.graceHours || saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const result = await novedadesApi.patch<{ graceHours: number; minHours: number; maxHours: number }>(
              "overtime/settings",
              { graceHours: hours },
            );
            setSaving(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setConfig(result.data);
            showToast(`Plazo de Horas extras: ${result.data.graceHours} horas laborables.`, "success");
          }}
        >
          Guardar
        </Button>
      </div>
      {!valid && <p className="text-xs text-danger">Ingrese un número entero entre {config.minHours} y {config.maxHours}.</p>}
      <ErrorBox message={error} />
    </div>
  );
}
