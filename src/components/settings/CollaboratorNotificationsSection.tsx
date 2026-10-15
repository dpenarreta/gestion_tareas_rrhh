"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, novedadesApi } from "@/components/novedades/api";
import { ErrorBox, Label, SelectInput, TextInput } from "@/components/novedades/fields";
import SectionCard from "@/components/settings/SectionCard";

type Kind = "ENTRY" | "EXIT";
type Recipient = {
  id: number;
  kind: Kind;
  email: string;
  area: string;
  areaLabel: string;
  isActive: boolean;
  updatedAt: string;
  updatedBy: string;
};
type Config = {
  recipients: Recipient[];
  activeCount: Record<Kind, number>;
  delivery: "smtp" | "console" | "other";
  areas: { value: string; label: string }[];
};
type MailStatus = "WAITING" | "PENDING" | "SENDING" | "SENT" | "FAILED";
type RecipientState = { email: string; status: "SENT" | "FAILED"; sentAt: string | null; error: string };
type MailEvent = {
  id: number;
  kind: Kind;
  collaborator: { id: number; cedula: string; fullName: string };
  supervisor: string;
  changedBy: string;
  changedAt: string;
  createdAt: string;
  firstDay: string | null;
  secondDay: string | null;
  period: string;
  status: MailStatus;
  statusLabel: string;
  recipients: RecipientState[];
  attempts: number;
  lastError: string;
  sentAt: string | null;
};

const KIND_TITLE: Record<Kind, string> = {
  ENTRY: "A. Destinatarios de notificaciones de ingreso",
  EXIT: "B. Destinatarios de notificaciones de salida",
};
const KIND_HELP: Record<Kind, string> = {
  ENTRY:
    "Reciben el correo cuando un colaborador registrado como nuevo ingreso alcanza su segundo día laborado en Días laborados.",
  EXIT: "Reciben el correo cuando un colaborador pasa de Activo a Inactivo.",
};
const KIND_SHORT: Record<Kind, string> = { ENTRY: "Ingreso", EXIT: "Salida" };
const STATUS_VARIANT: Record<MailStatus, "neutral" | "warning" | "info" | "success" | "danger"> = {
  WAITING: "neutral",
  PENDING: "warning",
  SENDING: "info",
  SENT: "success",
  FAILED: "danger",
};

// Notificaciones de colaboradores: dos listas independientes (ingreso y
// salida). Una dirección de una lista no recibe el otro tipo salvo que también
// esté registrada ahí. Solo el Administrador; Django lo valida en cada llamada.
export default function CollaboratorNotificationsSection() {
  const { showToast } = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [events, setEvents] = useState<MailEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cfg, evs] = await Promise.all([
      novedadesApi.get<Config>("collaborator-notifications/recipients"),
      novedadesApi.get<MailEvent[]>("collaborator-notifications/events"),
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

  async function retry(event: MailEvent) {
    setBusy(`retry-${event.kind}-${event.id}`);
    const result = await novedadesApi.post<MailEvent>(`collaborator-notifications/events/${event.kind}/${event.id}/retry`);
    setBusy(null);
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
    <SectionCard title="Notificaciones de colaboradores">
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
            NEXO envía un correo por cada destinatario activo de la lista correspondiente. «Enviado» significa que el
            servidor de correo aceptó el mensaje, no que ya fue leído. Pensado para las personas designadas de
            Operaciones, Jefatura de Operaciones y Talento Humano.
          </p>
          {config.delivery !== "smtp" && (
            <Badge variant="warning">Correo en modo de prueba: los mensajes no salen del servidor</Badge>
          )}
          <ErrorBox message={error} />

          {(["ENTRY", "EXIT"] as Kind[]).map((kind) => (
            <RecipientList
              key={kind}
              kind={kind}
              config={config}
              onError={setError}
              onChanged={(message) => {
                setError(null);
                if (message) showToast(message, "success");
                load();
              }}
            />
          ))}

          <div>
            <h4 className="text-sm font-semibold text-title mb-2">Últimos envíos</h4>
            {events.length === 0 ? (
              <p className="text-sm text-secondary">Aún no se ha registrado ningún ingreso ni salida con notificación.</p>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-surface2 text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2">Tipo</th>
                      <th className="text-left px-3 py-2">Evento</th>
                      <th className="text-left px-3 py-2">Colaborador</th>
                      <th className="text-left px-3 py-2">Período</th>
                      <th className="text-left px-3 py-2">Notificación</th>
                      <th className="text-left px-3 py-2">Destinatarios</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={`${e.kind}-${e.id}`} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          <Badge variant={e.kind === "ENTRY" ? "info" : "neutral"}>{KIND_SHORT[e.kind]}</Badge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {e.kind === "ENTRY" ? (
                            e.secondDay ? (
                              <>
                                2.º día: {formatDate(e.secondDay)}
                                <div className="text-secondary">1.º día: {formatDate(e.firstDay)}</div>
                              </>
                            ) : (
                              <span className="text-secondary">Alta del {formatDateTime(e.createdAt)}</span>
                            )
                          ) : (
                            <>
                              {formatDateTime(e.changedAt)}
                              <div className="text-secondary">por {e.changedBy}</div>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {e.collaborator.fullName}
                          <div className="text-secondary">
                            {e.collaborator.cedula}
                            {e.supervisor ? ` · ${e.supervisor}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{e.period || "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANT[e.status]}>{e.statusLabel}</Badge>
                          <div className="text-secondary mt-1">
                            {e.attempts} intento(s){e.sentAt ? ` · ${formatDateTime(e.sentAt)}` : ""}
                          </div>
                          {e.lastError && <div className="text-danger mt-1 max-w-[260px]">{e.lastError}</div>}
                        </td>
                        <td className="px-3 py-2 text-secondary">
                          {e.recipients.length === 0
                            ? "—"
                            : e.recipients.map((r) => (
                                <div key={r.email}>
                                  {r.status === "SENT" ? "✓" : "✗"} {r.email}
                                </div>
                              ))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {e.status === "FAILED" || e.status === "PENDING" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === `retry-${e.kind}-${e.id}`}
                              onClick={() => retry(e)}
                            >
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

function RecipientList({
  kind,
  config,
  onError,
  onChanged,
}: {
  kind: Kind;
  config: Config;
  onError: (message: string) => void;
  onChanged: (message?: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [area, setArea] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: number; email: string; area: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const recipients = config.recipients.filter((r) => r.kind === kind);
  const active = config.activeCount[kind] ?? 0;

  async function add() {
    setSaving(true);
    const result = await novedadesApi.post<Recipient>("collaborator-notifications/recipients", { kind, email, area });
    setSaving(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setEmail("");
    setArea("");
    onChanged(`Destinatario ${result.data.email} agregado a ${KIND_SHORT[kind].toLowerCase()}s.`);
  }

  async function update(id: number, changes: Partial<{ email: string; area: string; isActive: boolean }>) {
    setBusyId(id);
    const result = await novedadesApi.patch<Recipient>(`collaborator-notifications/recipients/${id}`, changes);
    setBusyId(null);
    if (!result.ok) {
      onError(result.error);
      return false;
    }
    onChanged();
    return true;
  }

  const areaSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <SelectInput value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Sin área</option>
      {config.areas.map((a) => (
        <option key={a.value} value={a.value}>
          {a.label}
        </option>
      ))}
    </SelectInput>
  );

  return (
    <section aria-label={KIND_TITLE[kind]} className="space-y-3 border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-title">{KIND_TITLE[kind]}</h4>
        <Badge variant={active > 0 ? "success" : "warning"}>{active} activo(s)</Badge>
      </div>
      <p className="text-xs text-secondary">{KIND_HELP[kind]}</p>
      {active === 0 && (
        <p className="text-xs text-warning">
          Sin destinatarios activos: los eventos se registran, pero ningún correo de {KIND_SHORT[kind].toLowerCase()} se
          envía hasta configurar al menos uno (luego puede reintentarlos desde «Últimos envíos»).
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[220px]">
          <Label>Correo electrónico</Label>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@empresa.com"
            aria-label={`Nuevo correo de ${KIND_SHORT[kind].toLowerCase()}`}
          />
        </label>
        <label className="block w-56">
          <Label hint="opcional">Área</Label>
          {areaSelect(area, setArea, `Área del nuevo correo de ${KIND_SHORT[kind].toLowerCase()}`)}
        </label>
        <Button onClick={add} loading={saving} disabled={!email.trim()}>
          Agregar
        </Button>
      </div>
      {recipients.length === 0 ? (
        <p className="text-sm text-secondary">Todavía no hay destinatarios en esta lista.</p>
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
              {recipients.map((r) => (
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
                        {areaSelect(editing.area, (v) => setEditing({ ...editing, area: v }), `Área de ${r.email}`)}
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
    </section>
  );
}
