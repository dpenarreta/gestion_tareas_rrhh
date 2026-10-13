"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, novedadesApi } from "./api";
import { ErrorBox } from "./fields";
import { OVERTIME_STATUS_LABEL, PERM, type OvertimeMonth } from "./types";
import type { ModuleContext } from "./NovedadesModule";

/** "1 d 4 h", "3 h 20 min" o "12 min": el tiempo que queda del plazo. */
export function formatRemaining(seconds: number): string {
  const minutes = Math.max(Math.floor(seconds / 60), 0);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

const TONE: Record<OvertimeMonth["status"], string> = {
  OPEN: "border-border bg-surface",
  GRACE: "border-warning/40 bg-warning/[.08]",
  OVERDUE: "border-danger/40 bg-danger/[.06]",
  CLOSED: "border-border bg-surface2",
  FUTURE: "border-border bg-surface",
};

/**
 * Estado del mes de Horas extras. Todo lo que muestra (estado, fecha límite,
 * tiempo restante) lo calcula Django: la pantalla no recalcula el plazo.
 * "Vencido" no bloquea —no hay cierre automático—; solo "Cerrado" deja el
 * mes en solo lectura, y eso lo hace el botón "Cerrar mes".
 */
export default function OvertimeMonthBanner({
  ctx,
  month,
  supervisorId,
}: {
  ctx: ModuleContext;
  month: OvertimeMonth;
  supervisorId: number | null;
}) {
  // Cuenta regresiva local a partir del valor del servidor (el componente se
  // monta de nuevo con cada estado recibido: ver `key` en OvertimeView); al
  // llegar a cero se vuelve a pedir el estado, que es el que decide.
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  const [confirming, setConfirming] = useState(false);
  const { refreshOvertimeMonths } = ctx;
  const remaining = month.remainingSeconds - Math.floor((now - started) / 1000);
  useEffect(() => {
    if (month.status !== "GRACE" && month.status !== "OPEN") return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (month.remainingSeconds - Math.floor((current - started) / 1000) <= 0) {
        clearInterval(timer);
        refreshOvertimeMonths();
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [month.remainingSeconds, month.status, refreshOvertimeMonths, started]);

  const canClose =
    ctx.can(PERM.cerrar) &&
    !ctx.me.isAssistant &&
    supervisorId !== null &&
    (month.status === "GRACE" || month.status === "OVERDUE");
  const national = supervisorId === null && month.supervisorsTotal !== undefined;

  return (
    <div className={`border rounded-xl px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3 ${TONE[month.status]}`} role="status">
      <div className="space-y-0.5">
        <p className="font-semibold text-title flex items-center gap-1.5">
          {month.status === "CLOSED" ? <Lock className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
          Horas extras {month.label}: {OVERTIME_STATUS_LABEL[month.status]}
          {national && ` · ${month.supervisorsClosed}/${month.supervisorsTotal} supervisores cerraron`}
        </p>
        {month.status === "OPEN" && (
          <p className="text-secondary">
            Mes en curso. Al terminar, queda un plazo de {month.graceHours} horas laborables para completar y corregir:
            hasta el <strong>{month.deadlineLabel}</strong>.
          </p>
        )}
        {month.status === "GRACE" && (
          <p className={month.closingSoon ? "text-warning font-medium" : "text-secondary"}>
            {month.closingSoon ? "Plazo próximo a vencer. " : ""}
            Se puede completar y corregir hasta el <strong>{month.deadlineLabel}</strong> (quedan {formatRemaining(remaining)}).
            El mes actual se registra aparte, al mismo tiempo.
          </p>
        )}
        {month.status === "OVERDUE" && (
          <p className="text-danger">
            El plazo venció el <strong>{month.deadlineLabel}</strong> y el mes sigue sin cerrar. Todavía se puede editar
            hasta que el supervisor o el Administrador pulse «Cerrar mes».
          </p>
        )}
        {month.status === "CLOSED" && (
          <p className="text-secondary">
            Solo lectura{month.closedBy ? `: cerrado por ${month.closedBy}` : ""}
            {month.closedAt ? ` el ${formatDateTime(month.closedAt)}` : ""}. Los cambios requieren una corrección
            autorizada del Administrador. La consulta y la exportación siguen disponibles.
          </p>
        )}
      </div>
      {canClose && (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          <Lock className="w-4 h-4" /> Cerrar mes
        </Button>
      )}
      {confirming && supervisorId !== null && (
        <CloseMonthDialog
          month={month}
          supervisorId={supervisorId}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            refreshOvertimeMonths();
          }}
        />
      )}
    </div>
  );
}

function CloseMonthDialog({
  month,
  supervisorId,
  onClose,
  onDone,
}: {
  month: OvertimeMonth;
  supervisorId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const result = await novedadesApi.post<{ alreadyClosed: boolean }>("overtime/months/close", {
      period: month.code,
      supervisorId,
      confirm: true,
    });
    setSaving(false);
    inFlight.current = false;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    showToast(result.data.alreadyClosed ? `${month.label} ya estaba cerrado.` : `Horas extras de ${month.label} cerrado.`, "success");
    onDone();
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} size="sm">
      <ModalHeader title={`Cerrar Horas extras de ${month.label}`} onClose={onClose} />
      <div className="p-5 space-y-3 text-sm">
        <p>
          Al cerrar, el mes queda en <strong>solo lectura</strong> para este equipo: no se podrán crear, editar,
          eliminar ni importar registros de {month.label}. Después, solo el Administrador puede corregir con motivo.
        </p>
        <p className="text-secondary">Días laborados (corte 23 → 22) se cierra aparte y no se ve afectado.</p>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving} disabled={saving}>
            Cerrar mes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
