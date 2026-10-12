"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Users } from "lucide-react";
import { novedadesApi } from "./api";
import { SelectInput } from "./fields";
import { PERM, type NovedadesMe, type PeriodOption, type SupervisorOption } from "./types";
import WorkedDaysGrid from "./WorkedDaysGrid";
import OvertimeView from "./OvertimeView";
import CollaboratorsView from "./CollaboratorsView";
import HistoryView from "./HistoryView";
import RepositoryView from "./RepositoryView";

type Tab = "DIAS" | "HORAS" | "BASE" | "HISTORIAL" | "REPOSITORIO";

const TAB_LABEL: Record<Tab, string> = {
  DIAS: "Días laborados",
  HORAS: "Horas extras",
  BASE: "Base de colaboradores",
  HISTORIAL: "Historial de registros",
  REPOSITORIO: "Repositorio mensual",
};

export type ModuleContext = {
  me: NovedadesMe;
  can: (codename: string) => boolean;
  period: string;
  supervisorId: number | null;
  supervisors: SupervisorOption[];
  refreshPeriods: () => void;
  openPeriod: (code: string, supervisorId?: number | null) => void;
  /** Las pantallas con edición avisan si tienen cambios sin guardar. */
  setDirty: (dirty: boolean) => void;
};

export default function NovedadesModule({ me }: { me: NovedadesMe }) {
  const can = useCallback((codename: string) => me.permissions.includes(codename), [me.permissions]);
  const tabs = useMemo(() => {
    const list: Tab[] = ["DIAS", "HORAS", "BASE"];
    if (me.canViewHistory) list.push("HISTORIAL");
    if (can(PERM.historial)) list.push("REPOSITORIO");
    return me.isAssistant ? (["HORAS", ...list.filter((t) => t !== "HORAS")] as Tab[]) : list;
  }, [can, me.isAssistant, me.canViewHistory]);

  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [supervisors, setSupervisors] = useState<SupervisorOption[]>([]);
  const [supervisorId, setSupervisorId] = useState<number | null>(me.isSupervisor ? me.user.id : null);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [period, setPeriod] = useState<string>(me.currentPeriod.code);
  const [periodsVersion, setPeriodsVersion] = useState(0);
  // Ref (no estado): avisar cambios sin guardar no debe re-renderizar el módulo.
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  // Cambiar de pestaña, período o supervisor desmonta la tabla en edición:
  // se pide confirmación para no perder lo escrito.
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current && !window.confirm("Hay cambios sin guardar que se perderán. ¿Continuar?")) return;
    dirtyRef.current = false;
    action();
  }, []);

  useEffect(() => {
    if (me.isSupervisor && !me.nationalWrite) return;
    novedadesApi.get<SupervisorOption[]>("supervisors").then((r) => {
      if (!r.ok) return;
      setSupervisors(r.data);
      // El Asistente arranca en el consolidado nacional (todos); quien entra
      // a Días laborados necesita un equipo concreto.
      setSupervisorId((current) => current ?? (me.isAssistant ? null : r.data[0]?.id ?? null));
    });
  }, [me.isSupervisor, me.nationalWrite, me.isAssistant]);

  useEffect(() => {
    novedadesApi.get<PeriodOption[]>("periods", { supervisor: supervisorId ?? undefined }).then((r) => {
      if (r.ok) setPeriods(r.data);
    });
  }, [supervisorId, periodsVersion]);

  const ctx: ModuleContext = {
    me,
    can,
    period,
    supervisorId,
    supervisors,
    refreshPeriods: () => setPeriodsVersion((v) => v + 1),
    openPeriod: (code, sid) =>
      guard(() => {
        setPeriod(code);
        if (sid !== undefined) setSupervisorId(sid);
        setTab(me.isAssistant ? "HORAS" : "DIAS");
      }),
    setDirty,
  };

  const showSupervisorPicker = !me.isSupervisor || me.nationalWrite;
  const needsSupervisor = tab === "DIAS" && supervisorId === null;
  const selectedPeriod = periods.find((p) => p.code === period);

  return (
    <div className="flex flex-col min-h-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-title">Control Operativo de Novedades</h1>
          <p className="text-secondary text-sm">
            Días laborados y horas extras de la operación · corte del 23 al 22 de cada mes
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {showSupervisorPicker && (
            <label className="min-w-[220px]">
              <span className="block text-xs font-semibold text-secondary mb-1">Supervisor</span>
              <SelectInput
                value={supervisorId ?? ""}
                onChange={(e) => {
                  const value = e.target.value ? Number(e.target.value) : null;
                  guard(() => setSupervisorId(value));
                }}
              >
                {tab !== "DIAS" && <option value="">Todos los supervisores</option>}
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </label>
          )}
          <label className="min-w-[230px]">
            <span className="block text-xs font-semibold text-secondary mb-1">Período</span>
            <SelectInput
              value={period}
              onChange={(e) => {
                const value = e.target.value;
                guard(() => setPeriod(value));
              }}
            >
              {!periods.some((p) => p.code === period) && <option value={period}>{period}</option>}
              {periods.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                  {p.status === "CLOSED" ? " · cerrado" : p.status === "OPEN" ? " · abierto" : ""}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>
      </div>
      {selectedPeriod && (
        <p className="text-xs text-secondary -mt-2">
          Corte: {selectedPeriod.startDate.split("-").reverse().join("/")} al{" "}
          {selectedPeriod.endDate.split("-").reverse().join("/")}
        </p>
      )}

      <div className="flex items-center border-b border-border pb-0.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => guard(() => setTab(t))}
            className={`px-4 py-2.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors rounded-t-lg ${
              tab === t
                ? "border-primary text-primary bg-primary-surface/60"
                : "border-transparent text-secondary hover:text-title hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {needsSupervisor ? (
        <EmptyState
          icon={Users}
          title={supervisors.length ? "Seleccione un supervisor" : "Sin supervisores"}
          description={
            supervisors.length
              ? "Días laborados se trabaja por equipo: elija el supervisor en el selector de arriba."
              : "Todavía no hay usuarios con el rol Supervisor de Operaciones. Créelos desde Usuarios."
          }
        />
      ) : (
        <>
          {tab === "DIAS" && supervisorId !== null && <WorkedDaysGrid ctx={ctx} supervisorId={supervisorId} />}
          {tab === "HORAS" && <OvertimeView ctx={ctx} />}
          {tab === "BASE" && <CollaboratorsView ctx={ctx} />}
          {tab === "HISTORIAL" && <HistoryView ctx={ctx} />}
          {tab === "REPOSITORIO" && <RepositoryView ctx={ctx} />}
        </>
      )}
    </div>
  );
}
