"use client";

import { useState } from "react";
import type { Role } from "@/generated/prisma/client";
import KpisModule from "./KpisModule";
import MyKpisModule from "./MyKpisModule";

type Props = {
  currentUserId: string;
  currentUserRole: Role;
  currentUserName: string;
};

export default function AnalyticsModule({ currentUserId, currentUserRole, currentUserName }: Props) {
  const [tab, setTab] = useState<"team" | "personal">("team");

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-0.5 bg-surface2 rounded-[10px] p-1">
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

      {tab === "team" ? (
        <KpisModule currentUserId={currentUserId} currentUserRole={currentUserRole} />
      ) : (
        <MyKpisModule currentUserName={currentUserName} currentUserRole={currentUserRole} />
      )}
    </div>
  );
}
