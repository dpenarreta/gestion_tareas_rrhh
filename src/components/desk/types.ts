export type DeskNotePriority = "INFORMACION" | "RECORDATORIO" | "IMPORTANTE" | "URGENTE";

export type DeskNote = {
  id: string;
  message: string;
  priority: DeskNotePriority;
  read: boolean;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  isMine: boolean;
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

// Franja pastel superior — el cuerpo de la nota permanece neutro/limpio,
// el color solo vive en esa franja (ver pedido del Sprint 1, sección Diseño).
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

// Rotación determinística (1°-3°, signo alternado) a partir del id — estable
// entre renders/refetch en vez de Math.random() en cada render.
export function rotationFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 997;
  const magnitude = 1 + (hash % 3); // 1..3
  const sign = hash % 2 === 0 ? 1 : -1;
  return magnitude * sign;
}
