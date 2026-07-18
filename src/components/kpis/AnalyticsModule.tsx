"use client";

import { useState } from "react";
import type { Role } from "@/generated/prisma/client";
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
  const isJefeNacional = currentUserRole === "JEFE_NACIONAL";
  const [tab, setTab] = useState<Tab>(isJefeNacional ? "ejecutivo" : "team");

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-0.5 bg-surface2 rounded-[10px] p-1">
          {isJefeNacional && (
            <button
              onClick={() => setTab("ejecutivo")}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
                tab === "ejecutivo" ? "bg-surface text-title font-semibold shadow-[var(--shadow)]" : "text-secondary hover:text-title font-medium"
              }`}
            >
              Resumen ejecutivo
            </button>
          )}
          <button
            onClick={() => setTab("team")}
            className={`px-3.5 py-1.5 rounded-[8px] text-[13px] transition-all ${
              tab === "team" ? "bg-surface text-title font-semibold shadow-[var(--shadow)]" : "text-secondary hover:text-title font-medium"
            }`}
          >
            Equipo
          </button>
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

      {tab === "ejecutivo" && isJefeNacional && <ExecutiveDashboard />}
      {tab === "team" && <KpisModule currentUserId={currentUserId} currentUserRole={currentUserRole} />}
      {tab === "personal" && <MyKpisModule currentUserName={currentUserName} currentUserRole={currentUserRole} />}
    </div>
  );
}
