"use client";

import type { Role } from "@/generated/prisma/client";
import { isExecutorRole, canViewTeam } from "@/lib/roles";
import TrendOverviewCards from "./TrendOverviewCards";
import OperationalStabilityCard from "./OperationalStabilityCard";
import PredictionCards from "./PredictionCards";
import PreventiveAlertsPanel from "./PreventiveAlertsPanel";
import ScenarioSimulatorPanel from "./ScenarioSimulatorPanel";
import TrendCharts from "./TrendCharts";
import TeamSubutilizationScan from "./TeamSubutilizationScan";
import ProjectDelayList from "./ProjectDelayList";

type Props = {
  currentUserId: string;
  currentUserRole: Role;
  currentUserName: string;
};

/**
 * Sprint E — Analytics Predictivo e Inteligencia Preventiva. Módulo NUEVO y
 * autónomo (§Bloque 15): no modifica Dashboard/Analytics(KPIs)/Reportes/
 * Proyectos/Equipo — la integración profunda con esas pantallas queda para
 * un sprint futuro (ver docs/AUDIT_LOG.md § Sprint E). La composición
 * individual/equipo reutiliza los mismos predicados que ya separan
 * /my-kpis de /kpis (isExecutorRole/canViewTeam) — sin gate de navegación
 * nuevo, la visibilidad se decide aquí.
 */
export default function PreventiveIntelligenceModule({ currentUserId, currentUserRole, currentUserName }: Props) {
  const showIndividual = isExecutorRole(currentUserRole);
  const showTeam = canViewTeam(currentUserRole);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-title">Inteligencia Preventiva</h1>
        <p className="text-sm text-secondary mt-0.5">
          Tendencias, predicciones y alertas preventivas basadas exclusivamente en el histórico de {currentUserName} en NEXO — sin
          inteligencia artificial generativa.
        </p>
      </div>

      {showIndividual && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-title">Mi actividad</h2>
          <TrendOverviewCards userId={currentUserId} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 space-y-3">
              <PredictionCards userId={currentUserId} />
            </div>
            <div className="space-y-3">
              <OperationalStabilityCard userId={currentUserId} />
              <PreventiveAlertsPanel endpoint={`/api/predictive/alerts/${currentUserId}`} title="Alertas preventivas" />
            </div>
          </div>
          <TrendCharts userId={currentUserId} />
          <ScenarioSimulatorPanel userId={currentUserId} isTeam={showTeam} />
        </section>
      )}

      {showTeam && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-title">Equipo</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <TeamSubutilizationScan />
            <ProjectDelayList />
          </div>
          <PreventiveAlertsPanel endpoint="/api/predictive/team-alerts" title="Alertas preventivas del equipo" />
          {!showIndividual && <ScenarioSimulatorPanel userId={currentUserId} isTeam={showTeam} />}
        </section>
      )}
    </div>
  );
}
