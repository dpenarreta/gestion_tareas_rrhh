"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/generated/prisma/client";
import { SETTINGS_CATEGORY_LABEL, type SettingsCategory } from "@/lib/settingsCategories";
import CategoryNav from "@/components/settings/CategoryNav";
import SearchBox from "@/components/settings/SearchBox";
import FavoritesSection, { FavoritesProvider } from "@/components/settings/FavoritesSection";
import ConfigSectionCard from "@/components/settings/ConfigSectionCard";
import ProximamenteCard from "@/components/settings/ProximamenteCard";
import GlobalParamsSection from "@/components/settings/GlobalParamsSection";
import { getDescriptor, searchSettings, SETTINGS_REGISTRY } from "@/components/settings/registry";

// ── Secciones existentes (migradas 1:1 desde SettingsManager.tsx) ──────────
import RoleCompatibilitySection from "@/components/settings/RoleCompatibilitySection";
import RoleTargetsSection from "@/components/settings/RoleTargetsSection";
import AnalyticsConfigSection from "@/components/settings/AnalyticsConfigSection";
import NormalizationCurvesSection from "@/components/settings/NormalizationCurvesSection";
import PredictionWindowSection from "@/components/settings/PredictionWindowSection";
import EngineDiagnosticsSection from "@/components/settings/EngineDiagnosticsSection";
import DataQualitySection from "@/components/settings/DataQualitySection";
import ActivityReasonsSection from "@/components/settings/ActivityReasonsSection";
import HolidaysSection from "@/components/settings/HolidaysSection";
import LeaveRecordsSection from "@/components/settings/LeaveRecordsSection";
import SpecialStatusSection from "@/components/settings/SpecialStatusSection";
import KpiStartDateSection from "@/components/settings/KpiStartDateSection";
import WorkloadConfigSection from "@/components/settings/WorkloadConfigSection";
import TrabajoAvanzadoSection from "@/components/settings/TrabajoAvanzadoSection";
import EscritorioDigitalConfigSection from "@/components/settings/EscritorioDigitalConfigSection";
import KnowledgeBaseSection from "@/components/settings/KnowledgeBaseSection";
import NovaCacheSection from "@/components/settings/NovaCacheSection";
import PasswordManagementSection from "@/components/settings/PasswordManagementSection";
import SeguridadConfigSection from "@/components/settings/SeguridadConfigSection";
import DataConsentSection from "@/components/settings/DataConsentSection";
import DataRequestsSection from "@/components/settings/DataRequestsSection";
import RetentionPolicySection from "@/components/settings/RetentionPolicySection";
import NotificationRulesSection from "@/components/settings/NotificationRulesSection";
import WelcomeMessageSection from "@/components/settings/WelcomeMessageSection";
import SystemInfoSection from "@/components/settings/SystemInfoSection";
import DocumentationSection from "@/components/settings/DocumentationSection";

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  dataConsentAccepted: boolean;
  dataConsentAcceptedAt: string | null;
};

const d = getDescriptor;

function ConfigCenterInner({ currentUserRole }: { currentUserRole: Role }) {
  const isAdmin = currentUserRole === "ADMINISTRADOR";
  const [category, setCategory] = useState<SettingsCategory>("organizacion");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) queueMicrotask(loadUsers);
  }, [isAdmin, loadUsers]);

  function navigateTo(cat: string, anchor: string) {
    setCategory(cat as SettingsCategory);
    setQuery("");
    queueMicrotask(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (!isAdmin) return null;

  const searching = query.trim().length > 0;
  const results = searching ? searchSettings(query) : [];
  const counts = searching
    ? SETTINGS_REGISTRY.reduce<Partial<Record<SettingsCategory, number>>>((acc, desc) => {
        if (results.includes(desc)) acc[desc.category] = (acc[desc.category] ?? 0) + 1;
        return acc;
      }, {})
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchBox value={query} onChange={setQuery} />
      </div>

      <FavoritesSection onNavigate={navigateTo} />

      <div className="flex flex-col sm:flex-row gap-6">
        <CategoryNav active={category} onChange={setCategory} counts={counts} />

        <div className="flex-1 min-w-0 space-y-5">
          {searching ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-title">
                {results.length} resultado{results.length === 1 ? "" : "s"} para &quot;{query}&quot;
              </h2>
              {results.length === 0 ? (
                <p className="text-sm text-secondary">Sin coincidencias — intenta con otro término.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {results.map((desc) => (
                    <button
                      key={desc.id}
                      type="button"
                      onClick={() => navigateTo(desc.category, desc.id)}
                      className="text-left text-sm bg-surface border border-border rounded-lg px-3 py-2 hover:border-primary transition-colors"
                    >
                      <span className="font-medium text-title">{desc.label}</span>
                      <span className="text-disabled"> · {SETTINGS_CATEGORY_LABEL[desc.category]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {category === "organizacion" && (
                <>
                  {d("role-compatibility") && (
                    <ConfigSectionCard descriptor={d("role-compatibility")!}>
                      <RoleCompatibilitySection />
                    </ConfigSectionCard>
                  )}
                  {d("role-targets") && (
                    <ConfigSectionCard descriptor={d("role-targets")!}>
                      <RoleTargetsSection />
                    </ConfigSectionCard>
                  )}
                </>
              )}

              {category === "analytics" && (
                <>
                  <ConfigSectionCard descriptor={d("analytics-config")!}>
                    <AnalyticsConfigSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("normalization-curves")!}>
                    <NormalizationCurvesSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("prediction-window")!}>
                    <PredictionWindowSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("engine-diagnostics")!}>
                    <EngineDiagnosticsSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("data-quality")!}>
                    <DataQualitySection />
                  </ConfigSectionCard>
                </>
              )}

              {category === "trabajo" && (
                <>
                  <ConfigSectionCard descriptor={d("activity-reasons")!}>
                    <ActivityReasonsSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("holidays")!}>
                    <HolidaysSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("leave-records")!}>
                    <LeaveRecordsSection users={users} />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("special-status")!}>
                    <SpecialStatusSection users={users} />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("kpi-start-date")!}>
                    <KpiStartDateSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("workload-config")!}>
                    <WorkloadConfigSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("trabajo-avanzado")!}>
                    <TrabajoAvanzadoSection />
                  </ConfigSectionCard>
                </>
              )}

              {category === "proyectos" && (
                <ProximamenteCard
                  title="SLA y nivel de riesgo"
                  reason="Ninguno de los dos existe hoy en Proyectos (ni el campo ni la lógica) — agregarlos es una funcionalidad nueva, no una centralización de algo ya construido."
                  futureSprintLabel="Sprint K"
                />
              )}

              {category === "escritorio_digital" && (
                <ConfigSectionCard descriptor={d("escritorio-digital-config")!}>
                  <EscritorioDigitalConfigSection />
                </ConfigSectionCard>
              )}

              {category === "reportes" && (
                <ProximamenteCard
                  title="Plantillas, marca y programación automática"
                  reason="No existe ningún motor de plantillas (logo/portada/firmas) ni infraestructura de scheduler/email en el sistema — construirlos es el ítem de mayor alcance de todo este sprint."
                  futureSprintLabel="Sprint F"
                />
              )}

              {category === "nova" && (
                <>
                  <ConfigSectionCard descriptor={d("knowledge-base")!}>
                    <KnowledgeBaseSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("nova-cache")!}>
                    <NovaCacheSection />
                  </ConfigSectionCard>
                  <ProximamenteCard
                    title="Tono, idioma y módulos donde participa"
                    reason="Hoy el tono/idioma está hardcodeado en 5 prompts de sistema repartidos en 2 archivos, y no existe ningún interruptor por módulo (Dashboard/Analytics) — centralizarlo es más que este sprint confirmó construir."
                  />
                </>
              )}

              {category === "seguridad" && (
                <>
                  <ConfigSectionCard descriptor={d("password-management")!}>
                    <PasswordManagementSection users={users} loading={usersLoading} />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("seguridad-config")!}>
                    <SeguridadConfigSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("data-consent")!}>
                    <DataConsentSection users={users} loading={usersLoading} onUsersChanged={loadUsers} />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("data-requests")!}>
                    <DataRequestsSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("retention-policy")!}>
                    <RetentionPolicySection />
                  </ConfigSectionCard>
                  <ProximamenteCard
                    title="Permisos especiales por usuario"
                    reason="Toda la autorización de Nexo es hoy por Role (sin excepciones individuales) — agregar overrides por usuario es una capa de autorización nueva, y el pedido original pide explícitamente no modificar la seguridad existente."
                  />
                </>
              )}

              {category === "notificaciones" && (
                <ConfigSectionCard descriptor={d("notification-rules")!}>
                  <NotificationRulesSection />
                </ConfigSectionCard>
              )}

              {category === "parametros_globales" && <GlobalParamsSection />}

              {category === "sistema" && (
                <>
                  <ConfigSectionCard descriptor={d("welcome-message")!}>
                    <WelcomeMessageSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("system-info")!}>
                    <SystemInfoSection />
                  </ConfigSectionCard>
                  <ConfigSectionCard descriptor={d("documentation")!}>
                    <DocumentationSection />
                  </ConfigSectionCard>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConfigCenter({ currentUserRole }: { currentUserRole: Role }) {
  return (
    <FavoritesProvider>
      <ConfigCenterInner currentUserRole={currentUserRole} />
    </FavoritesProvider>
  );
}
