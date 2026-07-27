"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type TaskOption = { id: string; title: string };
type UserOption = { id: string; name: string };
type ProjectOption = { id: string; name: string };

type ScenarioType = "register_hours" | "complete_task" | "adjust_target_time" | "redistribute_load" | "add_participants";

const SCENARIO_LABEL: Record<ScenarioType, string> = {
  register_hours: "Agregar horas",
  complete_task: "Cerrar tareas",
  adjust_target_time: "Modificar tiempo objetivo",
  redistribute_load: "Redistribuir carga",
  add_participants: "Agregar participantes",
};

const FIELD_LABEL: Record<string, string> = {
  cargaPct: "Carga (%)",
  cargaLabel: "Carga",
  capacidadDisponiblePct: "Capacidad disponible (%)",
  capacidadDisponibleHoras: "Capacidad disponible (h)",
  cumplimientoPct: "Cumplimiento (%)",
  healthScore: "Equilibrio Operativo",
  healthClassification: "Clasificación Equilibrio",
  performanceScorePts: "Productividad (Performance Score)",
  performanceScoreClass: "Clasificación Productividad",
  estado: "Estado de capacidad",
  participants: "Participantes",
  avgRemainingHoursPerParticipant: "Horas restantes / participante",
};

function SnapshotTable({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const keys = Object.keys(before);
  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="text-left text-disabled">
          <th className="font-medium pb-1">Indicador</th>
          <th className="font-medium pb-1 text-right">Antes</th>
          <th className="font-medium pb-1 text-right">Después</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {keys.map((k) => (
          <tr key={k}>
            <td className="py-1 text-secondary">{FIELD_LABEL[k] ?? k}</td>
            <td className="py-1 text-right text-title">{String(before[k])}</td>
            <td className="py-1 text-right font-semibold text-title">{String(after[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Bloque 8 — Simulador de Escenarios. "Agregar horas"/"Cerrar tareas" llaman
 * al endpoint YA EXISTENTE `/api/analytics/simulate/[userId]` (sin
 * modificarlo — solo se consume). "Modificar tiempo objetivo"/"Redistribuir
 * carga"/"Agregar participantes" son escenarios nuevos, con rutas nuevas
 * (`/api/predictive/simulate/**`). Nunca persiste nada — solo muestra
 * before/after.
 */
export default function ScenarioSimulatorPanel({ userId, isTeam }: { userId: string; isTeam: boolean }) {
  const [scenario, setScenario] = useState<ScenarioType>("register_hours");
  const [hours, setHours] = useState(4);
  const [count, setCount] = useState(1);
  const [taskId, setTaskId] = useState("");
  const [newTargetTimeHours, setNewTargetTimeHours] = useState(8);
  const [toUserId, setToUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [additionalParticipants, setAdditionalParticipants] = useState(1);

  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [members, setMembers] = useState<UserOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/predictive/predictions/${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const opts: TaskOption[] = (json?.taskDelays ?? []).map((t: { taskId: string; title: string }) => ({ id: t.taskId, title: t.title }));
        setTasks(opts);
        if (opts[0]) setTaskId(opts[0].id);
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!isTeam) return;
    fetch("/api/predictive/team-subutilization")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((json) => {
        const opts: UserOption[] = (json.members ?? []).filter((m: UserOption) => m.id !== userId);
        setMembers(opts);
        if (opts[0]) setToUserId(opts[0].id);
      })
      .catch(() => {});
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then((json) => {
        const opts: ProjectOption[] = (json ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }));
        setProjects(opts);
        if (opts[0]) setProjectId(opts[0].id);
      })
      .catch(() => {});
  }, [isTeam, userId]);

  async function submit() {
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      let res: Response;
      if (scenario === "register_hours") {
        res = await fetch(`/api/analytics/simulate/${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "register_hours", hours }),
        });
      } else if (scenario === "complete_task") {
        res = await fetch(`/api/analytics/simulate/${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "complete_task", count }),
        });
      } else if (scenario === "adjust_target_time") {
        res = await fetch(`/api/predictive/simulate/${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, newTargetTimeHours }),
        });
      } else if (scenario === "redistribute_load") {
        res = await fetch(`/api/predictive/simulate/redistribute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromUserId: userId, toUserId, hours }),
        });
      } else {
        res = await fetch(`/api/predictive/simulate/project/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ additionalParticipants }),
        });
      }
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error al simular");
      else setResult(data);
    } catch {
      setError("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  }

  const scenarioOptions: ScenarioType[] = isTeam
    ? ["register_hours", "complete_task", "adjust_target_time", "redistribute_load", "add_participants"]
    : ["register_hours", "complete_task", "adjust_target_time"];

  return (
    <div className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow)] p-4 space-y-3">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Simulador de Escenarios</p>
      <p className="text-[11px] text-disabled">No guarda nada — solo muestra el impacto hipotético.</p>

      <div>
        <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Escenario</label>
        <select
          value={scenario}
          onChange={(e) => setScenario(e.target.value as ScenarioType)}
          className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {scenarioOptions.map((s) => (
            <option key={s} value={s}>
              {SCENARIO_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {(scenario === "register_hours" || scenario === "redistribute_load") && (
        <div>
          <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Horas</label>
          <input
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      {scenario === "complete_task" && (
        <div>
          <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Cantidad de tareas</label>
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      {scenario === "adjust_target_time" && (
        <>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Tarea</label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {tasks.length === 0 && <option value="">Sin tareas abiertas</option>}
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Nuevo tiempo objetivo (h)</label>
            <input
              type="number"
              min={0}
              value={newTargetTimeHours}
              onChange={(e) => setNewTargetTimeHours(Number(e.target.value))}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </>
      )}

      {scenario === "redistribute_load" && (
        <div>
          <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Redistribuir hacia</label>
          <select
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {members.length === 0 && <option value="">Sin compañeros de equipo</option>}
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {scenario === "add_participants" && (
        <>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Proyecto</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {projects.length === 0 && <option value="">Sin proyectos visibles</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-secondary mb-1 uppercase tracking-wide">Participantes a agregar</label>
            <input
              type="number"
              min={1}
              value={additionalParticipants}
              onChange={(e) => setAdditionalParticipants(Number(e.target.value))}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-danger bg-danger/[.09] rounded-lg px-3 py-2">{error}</p>}

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting ? "Simulando…" : "Simular impacto"}
      </Button>

      {!!result && typeof result === "object" && (
        <div className="pt-1">
          {"from" in (result as object) && "to" in (result as object) ? (
            <>
              <p className="text-[11px] font-semibold text-main mb-1">Origen</p>
              <SnapshotTable
                before={(result as { from: { before: Record<string, unknown> } }).from.before}
                after={(result as { from: { after: Record<string, unknown> } }).from.after}
              />
              <p className="text-[11px] font-semibold text-main mt-3 mb-1">Destino</p>
              <SnapshotTable
                before={(result as { to: { before: Record<string, unknown> } }).to.before}
                after={(result as { to: { after: Record<string, unknown> } }).to.after}
              />
            </>
          ) : (
            <SnapshotTable
              before={(result as { before: Record<string, unknown> }).before}
              after={(result as { after: Record<string, unknown> }).after}
            />
          )}
        </div>
      )}
    </div>
  );
}
