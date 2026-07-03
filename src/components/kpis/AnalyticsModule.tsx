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
        <h1 className="text-2xl font-bold text-title">Analytics</h1>
        <div className="flex rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setTab("team")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "team" ? "bg-primary text-white" : "text-main hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            Equipo
          </button>
          <button
            onClick={() => setTab("personal")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "personal" ? "bg-primary text-white" : "text-main hover:bg-black/5 dark:hover:bg-white/5"
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
