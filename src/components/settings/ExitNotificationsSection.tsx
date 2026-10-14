"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, novedadesApi } from "@/components/novedades/api";
import { ErrorBox, Label, SelectInput, TextInput } from "@/components/novedades/fields";
import SectionCard from "@/components/settings/SectionCard";

type Recipient = { id: number; email: string; area: string; areaLabel: string; isActive: boolean; updatedAt: string; updatedBy: string };
type Config = {
  recipients: Recipient[];
  activeCount: number;
  delivery: "smtp" | "console" | "other";
  areas: { value: string; label: string }[];
};
type ExitStatus = "PENDING" | "SENDING" | "SENT" | "FAILED";
type ExitEvent = {
  id: number;
  collaborator: { id: number; cedula: string; fullName: string };
  supervisor: string;
  changedBy: string;
  changedAt: string;
  period: string;
  status: ExitStatus;
  statusLabel: string;
  recipients: string[];
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string;
  sentAt: string | null;
};

const STATUS_VARIANT: Record<ExitStatus, "warning" | "info" | "success" | "danger"> = {
  PENDING: "warning",
  SENDING: "info",
  SENT: "success",
  FAILED: "danger",
};

// Notificaciones de salida de colaboradores: destinatarios del correo que sale
// cuando un supervisor pasa a alguien de Activo a Inactivo. Solo el
// Administrador ve esta sección y Django lo vuelve a exigir en cada llamada.
export default function ExitNotificationsSection() {
  const { showToast } = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [events, setEvents] = useState<ExitEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [area, setArea] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: number; email: string; area: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [cfg, evs] = await Promise.all([
      novedadesApi.get<Config>("exit-notifications/recipients"),
      novedadesApi.get<ExitEvent[]>("exit-notifications"),
    ]);
    if (!cfg.ok) {
      setError(cfg.error);
      return;
    }
    setConfig(cfg.data);
    if (evs.ok) setEvents(evs.data);
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function add() {
    setSaving(true);
    setError(null);
    const result = await novedadesApi.post<Recipient>("exit-notifications/recipients", { email, area });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail("");
    setArea("");
    showToast(`Destinatario ${result.data.email} agregado.`, "success");
    load();
  }

  async function update(id: number, changes: Partial<{ email: string; area: string; isActive: boolean }>) {
    setBusyId(id);
    setError(null);
    const result = await novedadesApi.patch<Recipient>(`exit-notifications/recipients/${id}`, changes);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    load();
    return true;
  }

  async function retry(event: ExitEvent) {
    setBusyId(-event.id);
    const result = await novedadesApi.post<ExitEvent>(`exit-notifications/${event.id}/retry`);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(
      result.data.status === "SENT"
        ? "Notificación enviada."
        : `No se pudo enviar: ${result.data.lastError || "error en la notificación"}.`,
      result.data.status === "SENT" ? "success" : "error",
    );
    load();
  }

  return (
    <SectionCard title="Notificaciones de salida de colaboradores">
      {config === null ? (
        error ? (
          <ErrorBox message={error} />
        ) : (
          <div className="flex justify-center py-8">
            <Spinner className="text-primary" />
          </div>
        )
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-secondary">
            Cuando un supervisor cambia a un colaborador de <strong>Activo</strong> a <strong>Inactivo</strong> en
            Control Operativo de Novedades, NEXO envía un correo a los destinatarios activos con sus datos y el detalle
            de Días laborados del período. Pensado para las personas designadas de Operaciones, Jefatura de
            Operaciones y Talento Humano. «Enviado» significa que el servidor de correo aceptó el mensaje, no que ya
            fue leído.
          </p>

          <div className="flex flex-wrap gap-2 items-center text-sm">
            <Badge variant={config.activeCount > 0 ? "success" : "warning"}>
              {config.activeCount} destinatario(s) activo(s)
            </Badge>
            {config.delivery !== "smtp" && (
              <Badge variant="warning">Correo en modo de prueba: los mensajes no salen del servidor</Badge>
            )}
          </div>
          {config.activeCount === 0 && (
            <p className="text-xs text-warning">
              No hay destinatarios activos: las salidas se registran, pero ningún correo se envía hasta configurar al
              menos uno (luego puede reintentarlas desde la lista de envíos).
            </p>
          )}

          <ErrorBox message={error} />

          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[220px]">
              <Label>Correo electrónico</Label>
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
            </label>
            <label className="block w-56">
              <Label hint="opcional">Área</Label>
              <SelectInput value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">Sin área</option>
                {config.areas.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </SelectInput>
            </label>
            <Button onClick={add} loading={saving} disabled={!email.trim()}>
              Agregar destinatario
            </Button>
          </div>

          {config.recipients.length === 0 ? (
            <p className="text-sm text-secondary">Todavía no hay destinatarios registrados.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-surface2 text-secondary text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Correo</th>
                    <th className="text-left px-3 py-2">Área</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-right px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {config.recipients.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      {editing?.id === r.id ? (
                        <>
                          <td className="px-3 py-2">
                            <TextInput
                              aria-label={`Editar correo ${r.email}`}
                              value={editing.email}
                              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <SelectInput value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })}>
                              <option value="">Sin área</option>
                              {config.areas.map((a) => (
                                <option key={a.value} value={a.value}>
                                  {a.label}
                                </option>
                              ))}
                            </SelectInput>
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right whitespace-nowrap space-x-2">
                            <Button
                              size="sm"
                              loading={busyId === r.id}
                              onClick={async () => {
                                if (await update(r.id, { email: editing.email, area: editing.area })) setEditing(null);
                              }}
                            >
                              Guardar
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                              Cancelar
                            </Button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-title">{r.email}</td>
                          <td className="px-3 py-2 text-secondary">{r.areaLabel || "—"}</td>
                          <td className="px-3 py-2">
                            <Badge variant={r.isActive ? "success" : "neutral"}>{r.isActive ? "Activo" : "Inactivo"}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap space-x-2">
                            <Button size="sm" variant="secondary" onClick={() => setEditing({ id: r.id, email: r.email, area: r.area })}>
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busyId === r.id}
                              onClick={() => update(r.id, { isActive: !r.isActive })}
                            >
                              {r.isActive ? "Desactivar" : "Activar"}
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-title mb-2">Últimos envíos</h4>
            {events.length === 0 ? (
              <p className="text-sm text-secondary">Aún no se ha registrado ninguna salida.</p>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-surface2 text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2">Cambio</th>
                      <th className="text-left px-3 py-2">Colaborador</th>
                      <th className="text-left px-3 py-2">Período</th>
                      <th className="text-left px-3 py-2">Notificación</th>
                      <th className="text-left px-3 py-2">Detalle</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDateTime(e.changedAt)}
                          <div className="text-secondary">por {e.changedBy}</div>
                        </td>
                        <td className="px-3 py-2">
                          {e.collaborator.fullName}
                          <div className="text-secondary">{e.collaborator.cedula} · {e.supervisor}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{e.period}</td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANT[e.status]}>{e.statusLabel}</Badge>
                          <div className="text-secondary mt-1">
                            {e.attempts} intento(s){e.sentAt ? ` · ${formatDateTime(e.sentAt)}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-secondary max-w-[320px]">
                          {e.lastError || (e.recipients.length ? e.recipients.join(", ") : "")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {e.status === "FAILED" || e.status === "PENDING" ? (
                            <Button size="sm" variant="secondary" loading={busyId === -e.id} onClick={() => retry(e)}>
                              Reintentar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
