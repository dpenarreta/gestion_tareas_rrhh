// Sin "server-only": lo usan tanto componentes de cliente (validación en vivo
// en el formulario) como rutas de API (validación autoritativa en el servidor).

/** "HH:MM" -> minutos desde medianoche, o null si el formato no es válido. */
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** true si [aStart,aEnd) se solapa con [bStart,bEnd) — cubre solapamiento parcial, contención total en cualquier dirección y coincidencia exacta. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const s1 = timeToMinutes(aStart);
  const e1 = timeToMinutes(aEnd);
  const s2 = timeToMinutes(bStart);
  const e2 = timeToMinutes(bEnd);
  if (s1 === null || e1 === null || s2 === null || e2 === null) return false;
  return s1 < e2 && s2 < e1;
}
