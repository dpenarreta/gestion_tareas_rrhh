"use client";

import { useState } from "react";
import TodayInbox from "./TodayInbox";
import NotesPanel from "./NotesPanel";
import RemindersPanel from "./RemindersPanel";
import CalendarPanel from "./CalendarPanel";
import SearchPanel from "./SearchPanel";

type Tab = "hoy" | "notas" | "recordatorios" | "calendario" | "buscar";

const TABS: { key: Tab; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "notas", label: "Notas" },
  { key: "recordatorios", label: "Recordatorios" },
  { key: "calendario", label: "Calendario" },
  { key: "buscar", label: "Buscar" },
];

export default function DeskBoard() {
  const [tab, setTab] = useState<Tab>("hoy");

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-title">Escritorio Digital</h1>
        <p className="text-sm text-secondary">Tu centro personal de trabajo — notas, recordatorios y lo que importa hoy.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-secondary hover:text-title"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "hoy" && <TodayInbox onGoToNotes={() => setTab("notas")} />}
      {tab === "notas" && <NotesPanel />}
      {tab === "recordatorios" && <RemindersPanel />}
      {tab === "calendario" && <CalendarPanel />}
      {tab === "buscar" && <SearchPanel />}
    </div>
  );
}
