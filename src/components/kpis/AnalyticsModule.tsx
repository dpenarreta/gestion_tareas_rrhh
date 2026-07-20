"use client";

import { useState } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LEVEL } from "@/lib/roles";
import KpisModule from "./KpisModule";
import MyKpisModule from "./MyKpisModule";
import ExecutiveDashboard from "./ExecutiveDashboard";

type Props = {
  currentUserId: string;
  currentUserRole: Role;
  currentUserName: string;
};

type Tab = "ejecutivo" | "team" | "personal";

export default function AnalyticsModule({ currentUserId, currentUserRole, currentUserName }: Props) {
  // Dashboard ejecutivo: Administrador, Jefe Nacional y Coordinador Nacional
  // (nivel >= 3) — cada uno ve su propio alcance vía getSubordinateRoles.
  const hasExecutiveDashboard = ROLE_LEVEL[currentUserRole] >= 3;
  // Componentes de equipo (Balance de carga, Capacidad, KPIs de subordinados):
  // solo roles con subordinados (nivel >= 2) — nivel 1 únicamente ve "Mi actividad".
  const hasTeamTab = ROLE_LEVEL[currentUserRole] >= 2;
  const [tab, setTab] = useState<Tab>(hasExecutiveDashboard ? "ejecutivo" : hasTeamTab ? "team" : "personal");

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-0.5 bg-surface2 rounded-[10px] p-1">
          {hasExecutiveDashboard && (
            <button
              onClick={() => setTab("ejecutivo")}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
                tab === "ejecutivo" ? "bg-surface text-title font-semibold shadow-[var(--shadow)]" : "text-secondary hover:text-title font-medium"
              }`}
            >
              Resumen ejecutivo
            </button>
          )}
          {hasTeamTab && (
            <button
              onClick={() => setTab("team")}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
                tab === "team" ? "bg-surface text-title font-semibold shadow-[var(--shadow)]" : "text-secondary hover:text-title font-medium"
              }`}
            >
              Equipo
            </button>
          )}
          <button
            onClick={() => setTab("personal")}
            className={`px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
              tab === "personal" ? "bg-surface text-title font-semibold shadow-[var(--shadow)]" : "text-secondary hover:text-title font-medium"
            }`}
          >
            Mi actividad
          </button>
        </div>
      </div>

      {tab === "ejecutivo" && hasExecutiveDashboard && <ExecutiveDashboard />}
      {tab === "team" && hasTeamTab && <KpisModule currentUserId={currentUserId} currentUserRole={currentUserRole} />}
      {tab === "personal" && (
        <MyKpisModule currentUserId={currentUserId} currentUserName={currentUserName} currentUserRole={currentUserRole} />
      )}
    </div>
  );
}
