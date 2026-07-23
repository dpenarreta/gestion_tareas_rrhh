export type DeskNotePriority = "INFORMACION" | "RECORDATORIO" | "IMPORTANTE" | "URGENTE";
export type DeskNoteColor = "AMARILLO" | "ROSADO" | "CELESTE" | "VERDE" | "NARANJA" | "LILA";

export type DeskNote = {
  id: string;
  message: string;
  priority: DeskNotePriority;
  color: DeskNoteColor;
  read: boolean;
  readAt: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  isMine: boolean;
  hasAttachment: boolean;
  attachmentName: string | null;
  attachmentMime: string | null;
  convertedToTaskId: string | null;
  convertedAt: string | null;
};

export type RecipientOption = {
  id: string;
  name: string;
  role: string;
};

export const PRIORITY_LABEL: Record<DeskNotePriority, string> = {
  INFORMACION: "Información",
  RECORDATORIO: "Recordatorio",
  IMPORTANTE: "Importante",
  URGENTE: "Urgente",
};

// Franja pastel superior — el color de fondo del Post-it (§Sprint evolución
// §1) es independiente de la prioridad; la franja sigue comunicando urgencia,
// el resto del cuerpo permanece limpio salvo el tinte de `color`.
export const PRIORITY_STRIPE: Record<DeskNotePriority, string> = {
  INFORMACION: "#8fd9b6",
  RECORDATORIO: "#f2d675",
  IMPORTANTE: "#f2b077",
  URGENTE: "#f0938a",
};

export const PRIORITY_DOT: Record<DeskNotePriority, string> = {
  INFORMACION: "#3fae7d",
  RECORDATORIO: "#c9a01a",
  IMPORTANTE: "#d97f36",
  URGENTE: "#dd6155",
};

export const COLOR_LABEL: Record<DeskNoteColor, string> = {
  AMARILLO: "Amarillo",
  ROSADO: "Rosado",
  CELESTE: "Celeste",
  VERDE: "Verde",
  NARANJA: "Naranja",
  LILA: "Lila",
};

// Fondo pastel del Post-it, claro/oscuro — la prioridad sigue viviendo solo
// en la franja superior (PRIORITY_STRIPE), así que ambas dimensiones de
// color conviven sin pisarse.
export const COLOR_BG_CLASSES: Record<DeskNoteColor, string> = {
  AMARILLO: "bg-[#fffbe6] dark:bg-[#332d10]",
  ROSADO: "bg-[#fef0f5] dark:bg-[#331824]",
  CELESTE: "bg-[#eef7ff] dark:bg-[#132534]",
  VERDE: "bg-[#f0faf3] dark:bg-[#12291c]",
  NARANJA: "bg-[#fff4ea] dark:bg-[#33220f]",
  LILA: "bg-[#f6f0fd] dark:bg-[#241a33]",
};

// Swatch sólido para el selector de color en el formulario (no depende de modo claro/oscuro).
export const COLOR_SWATCH: Record<DeskNoteColor, string> = {
  AMARILLO: "#f5d90a",
  ROSADO: "#f2a0c2",
  CELESTE: "#8ec9f5",
  VERDE: "#8fd9b6",
  NARANJA: "#f2b077",
  LILA: "#c7a8ec",
};

export function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "justo ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

/** Fecha y hora absolutas — "Fecha"/"Hora" como campos explícitos del pedido, mostrados en el tooltip del sello relativo. */
export function fmtAbsolute(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

// Rotación determinística (1°-3°, signo alternado) a partir del id — estable
// entre renders/refetch en vez de Math.random() en cada render.
export function rotationFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 997;
  const magnitude = 1 + (hash % 3); // 1..3
  const sign = hash % 2 === 0 ? 1 : -1;
  return magnitude * sign;
}

// ── Recordatorios personales ─────────────────────────────────────────────────

export type ReminderPriority = "BAJA" | "MEDIA" | "ALTA" | "URGENTE";
export type ReminderStatus = "PENDIENTE" | "COMPLETADO";
export type ReminderRepeat = "UNA_VEZ" | "DIARIO" | "SEMANAL" | "MENSUAL";

export type PersonalReminder = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  priority: ReminderPriority;
  status: ReminderStatus;
  repeat: ReminderRepeat;
  completedAt: string | null;
  createdAt: string;
};

export const REMINDER_PRIORITY_LABEL: Record<ReminderPriority, string> = {
  BAJA: "Baja",
  MEDIA: "Media",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

export const REMINDER_PRIORITY_COLOR: Record<ReminderPriority, string> = {
  BAJA: "#3fae7d",
  MEDIA: "#c9a01a",
  ALTA: "#d97f36",
  URGENTE: "#dd6155",
};

export const REMINDER_REPEAT_LABEL: Record<ReminderRepeat, string> = {
  UNA_VEZ: "Una sola vez",
  DIARIO: "Diario",
  SEMANAL: "Semanal",
  MENSUAL: "Mensual",
};

export function isOverdue(reminder: Pick<PersonalReminder, "status" | "dueAt">): boolean {
  return reminder.status === "PENDIENTE" && new Date(reminder.dueAt).getTime() < Date.now();
}

export function fmtDueRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "ahora";
  if (mins > 0) {
    if (mins < 60) return `en ${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `en ${hrs}h`;
    return `en ${Math.round(hrs / 24)}d`;
  }
  const pastMins = Math.abs(mins);
  if (pastMins < 60) return `hace ${pastMins} min`;
  const hrs = Math.round(pastMins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.round(hrs / 24)}d`;
}

export function fmtDueDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-CL", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
