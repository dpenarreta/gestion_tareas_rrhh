"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Clock, Pencil, Trash2, Repeat, Undo2, Archive, ArchiveRestore, History, ListTodo } from "lucide-react";
import { PriorityChip } from "@/components/ui/Chip";
import { REMINDER_PRIORITY_CONFIG } from "@/lib/chipConfig";
import {
  type PersonalReminder,
  REMINDER_REPEAT_LABEL,
  fmtDueRelative,
  fmtDueDateTime,
  isOverdue,
} from "./types";
import ReopenReminderModal from "./ReopenReminderModal";
import DeskHistoryModal from "./DeskHistoryModal";
import ConvertReminderToTaskModal from "./ConvertReminderToTaskModal";

/** Default = DEFAULT_SNOOZE_PRESETS_MINUTES en systemConfig.ts (no importable aquí: es "server-only"). */
const DEFAULT_SNOOZE_MINUTES = [15, 30, 60, 1440];

/** Etiqueta legible para un preset arbitrario de minutos (admite valores configurados, no solo los 4 por defecto). */
function formatSnoozeLabel(minutes: number): string {
  if (minutes === 1440) return "Mañana, misma hora";
  if (minutes < 60) return `${minutes} minutos`;
  if (minutes % 1440 === 0) return `${minutes / 1440} días`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hora" : `${minutes / 60} horas`;
  return `${minutes} minutos`;
}

function timestampAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

type Props = {
  reminder: PersonalReminder;
  onComplete: (id: string) => void;
  onPostpone: (id: string, dueAt: string) => void;
  onReopen: (id: string, dueAt?: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onEdit: (reminder: PersonalReminder) => void;
  onDelete: (id: string) => void;
  onConvertedToTask?: (id: string, taskId: string) => void;
  /** Presets de posposición en minutos — el padre que lista los recordatorios los obtiene una sola vez (ver /api/settings/snooze-presets). */
  snoozePresetsMinutes?: number[];
};

export default function ReminderCard({
  reminder,
  onComplete,
  onPostpone,
  onReopen,
  onArchive,
  onEdit,
  onDelete,
  onConvertedToTask,
  snoozePresetsMinutes = DEFAULT_SNOOZE_MINUTES,
}: Props) {
  const SNOOZE_OPTIONS = snoozePresetsMinutes.map((m) => ({ label: formatSnoozeLabel(m), ms: m * 60 * 1000 }));
  const [showSnooze, setShowSnooze] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [showReopen, setShowReopen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const overdue = isOverdue(reminder);
  const done = reminder.status === "COMPLETADO";

  function snooze(ms: number) {
    onPostpone(reminder.id, timestampAfter(ms));
    setShowSnooze(false);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="bg-surface border border-border rounded-2xl overflow-hidden shadow-[var(--shadow)]"
    >
      {overdue && (
        <div className="bg-danger/[.13] text-danger text-[11px] font-semibold px-4 py-1.5">
          Recordatorio pendiente
        </div>
      )}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          onClick={() => onComplete(reminder.id)}
          disabled={done}
          title={done ? "Completado" : "Marcar completado"}
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
            done ? "bg-success border-success text-white" : "border-border2 hover:border-success text-transparent hover:text-success/50"
          }`}
        >
          <Check className="w-3 h-3" strokeWidth={3} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PriorityChip value={reminder.priority} config={REMINDER_PRIORITY_CONFIG} className="shrink-0" />
            <p className={`text-sm font-medium truncate ${done ? "text-secondary line-through" : "text-title"}`}>{reminder.title}</p>
            {reminder.archived && (
              <span className="text-[10px] font-medium text-disabled bg-surface2 px-1.5 py-0.5 rounded-full shrink-0">Archivado</span>
            )}
            {reminder.convertedToTaskId && (
              <a
                href="/tasks"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary-surface px-1.5 py-0.5 rounded-full shrink-0 hover:brightness-95"
              >
                <ListTodo className="w-2.5 h-2.5" strokeWidth={2} />
                Convertido en tarea
              </a>
            )}
          </div>
          {reminder.description && (
            <p className="text-xs text-secondary mt-0.5 leading-snug">{reminder.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`text-[11px] ${overdue ? "text-danger font-medium" : "text-secondary"}`} title={fmtDueDateTime(reminder.dueAt)}>
              {fmtDueRelative(reminder.dueAt)} · {fmtDueDateTime(reminder.dueAt)}
            </span>
            {reminder.repeat !== "UNA_VEZ" && (
              <span className="flex items-center gap-1 text-[11px] text-primary bg-primary-surface px-1.5 py-0.5 rounded-full">
                <Repeat className="w-2.5 h-2.5" strokeWidth={2} />
                {REMINDER_REPEAT_LABEL[reminder.repeat]}
              </span>
            )}
          </div>
        </div>

        <div className="relative flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowHistory(true)}
            title="Ver historial"
            className="p-1.5 text-disabled hover:text-title hover:bg-surface2 rounded-lg transition-colors"
          >
            <History className="w-4 h-4" strokeWidth={1.8} />
          </button>

          {!reminder.convertedToTaskId && (
            <button
              onClick={() => setShowConvert(true)}
              title="Crear tarea"
              className="p-1.5 text-disabled hover:text-primary hover:bg-primary-surface rounded-lg transition-colors"
            >
              <ListTodo className="w-4 h-4" strokeWidth={1.8} />
            </button>
          )}

          {!done ? (
            <>
              <button
                onClick={() => setShowSnooze((v) => !v)}
                title="Posponer"
                className="p-1.5 text-disabled hover:text-primary hover:bg-primary-surface rounded-lg transition-colors"
              >
                <Clock className="w-4 h-4" strokeWidth={1.8} />
              </button>
              <button
                onClick={() => onEdit(reminder)}
                title="Editar"
                className="p-1.5 text-disabled hover:text-title hover:bg-surface2 rounded-lg transition-colors"
              >
                <Pencil className="w-4 h-4" strokeWidth={1.8} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowReopen(true)}
                title="Reabrir"
                className="p-1.5 text-disabled hover:text-primary hover:bg-primary-surface rounded-lg transition-colors"
              >
                <Undo2 className="w-4 h-4" strokeWidth={1.8} />
              </button>
              <button
                onClick={() => onArchive(reminder.id, !reminder.archived)}
                title={reminder.archived ? "Restaurar del archivo" : "Archivar"}
                className="p-1.5 text-disabled hover:text-title hover:bg-surface2 rounded-lg transition-colors"
              >
                {reminder.archived ? <ArchiveRestore className="w-4 h-4" strokeWidth={1.8} /> : <Archive className="w-4 h-4" strokeWidth={1.8} />}
              </button>
            </>
          )}

          <button
            onClick={() => onDelete(reminder.id)}
            title="Eliminar"
            className="p-1.5 text-disabled hover:text-danger hover:bg-danger-soft rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" strokeWidth={1.8} />
          </button>

          {showSnooze && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-border rounded-xl shadow-xl z-20 py-1.5">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => snooze(opt.ms)}
                  className="w-full text-left text-xs text-main px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {opt.label}
                </button>
              ))}
              <div className="px-3 py-1.5 flex items-center gap-1.5 border-t border-border mt-1 pt-1.5">
                <input
                  type="datetime-local"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="flex-1 text-[11px] border border-border rounded-lg px-1.5 py-1 bg-background text-title"
                />
                <button
                  disabled={!customDate}
                  onClick={() => {
                    onPostpone(reminder.id, new Date(customDate).toISOString());
                    setShowSnooze(false);
                  }}
                  className="text-[11px] font-medium text-primary disabled:opacity-40 shrink-0"
                >
                  Elegir
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReopen && (
        <ReopenReminderModal
          reminder={reminder}
          onClose={() => setShowReopen(false)}
          onReopen={(dueAt) => {
            onReopen(reminder.id, dueAt);
            setShowReopen(false);
          }}
        />
      )}
      {showHistory && (
        <DeskHistoryModal entityType="REMINDER" entityId={reminder.id} title={reminder.title} onClose={() => setShowHistory(false)} />
      )}
      {showConvert && (
        <ConvertReminderToTaskModal
          reminder={reminder}
          onClose={() => setShowConvert(false)}
          onConverted={(taskId) => {
            onConvertedToTask?.(reminder.id, taskId);
            setShowConvert(false);
          }}
        />
      )}
    </motion.div>
  );
}
