"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import TodayInbox from "./TodayInbox";
import NotesPanel from "./NotesPanel";
import RemindersPanel from "./RemindersPanel";
import CalendarPanel from "./CalendarPanel";
import GlobalSearchOverlay from "./GlobalSearchOverlay";
import NewNoteModal from "./NewNoteModal";

type Tab = "hoy" | "notas" | "recordatorios" | "calendario";

const TABS: { key: Tab; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "notas", label: "Notas" },
  { key: "recordatorios", label: "Recordatorios" },
  { key: "calendario", label: "Calendario" },
];

export default function DeskBoard() {
  const [tab, setTab] = useState<Tab>("hoy");
  const [showSearch, setShowSearch] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-title">Escritorio Digital</h1>
          <p className="text-sm text-secondary">Tu centro personal de trabajo — notas, recordatorios y lo que importa hoy.</p>
        </div>
        {/* Sprint C §2: "+ Nueva nota" disponible desde cualquier pestaña, no solo desde
            "Notas" — antes requería cambiar de pestaña primero (4 clics en total). */}
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="primary" onClick={() => setShowNewNote(true)}>
            + Nueva nota
          </Button>
          <Button variant="ghost" onClick={() => setShowSearch(true)}>
            <Search className="w-4 h-4" strokeWidth={2} />
            Buscar
          </Button>
        </div>
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

      {showSearch && <GlobalSearchOverlay onClose={() => setShowSearch(false)} />}

      {showNewNote && (
        <NewNoteModal
          onClose={() => setShowNewNote(false)}
          onCreated={() => {
            setShowNewNote(false);
            setTab("notas");
          }}
        />
      )}
    </div>
  );
}
