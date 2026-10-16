// Arrastre tipo Excel (Horas extras y Días laborados): cálculo puro del
// desplazamiento automático. Separado del hook para probarlo sin DOM.

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

/** Distancia al borde (px) desde la que empieza el desplazamiento automático. */
export const AUTO_SCROLL_ZONE = 48;
/** Velocidad máxima (px por cuadro, ~60 cuadros/s) al llegar o pasar el borde. */
export const AUTO_SCROLL_MAX = 22;

function axisStep(position: number, start: number, end: number, zone: number, max: number): number {
  // Progresivo: 0 al entrar en la zona, máximo en el borde o fuera de él.
  // El cuadrado suaviza el arranque para poder elegir la fila con precisión.
  const near = (distance: number) => Math.round(max * Math.min(1, (zone - distance) / zone) ** 2);
  if (position < start + zone) return -Math.max(1, near(position - start));
  if (position > end - zone) return Math.max(1, near(end - position));
  return 0;
}

/** Cuánto desplazar el contenedor en este cuadro según dónde está el puntero.
 * El puntero puede estar fuera del contenedor (se sigue desplazando). */
export function autoScrollStep(pointer: Point, box: Box, zone = AUTO_SCROLL_ZONE, max = AUTO_SCROLL_MAX) {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  // Contenedores chicos: la zona nunca ocupa más de un tercio.
  const zx = Math.min(zone, width / 3);
  const zy = Math.min(zone, height / 3);
  return {
    dx: width > 0 ? axisStep(pointer.x, box.left, box.right, zx, max) : 0,
    dy: height > 0 ? axisStep(pointer.y, box.top, box.bottom, zy, max) : 0,
  };
}

/** Punto dentro del contenedor más cercano al puntero: si el puntero salió
 * del área visible, la fila de destino es la del borde (la que va apareciendo
 * con el desplazamiento automático). */
export function clampToBox(pointer: Point, box: Box, inset = 2): Point {
  return {
    x: Math.min(Math.max(pointer.x, box.left + inset), box.right - inset),
    y: Math.min(Math.max(pointer.y, box.top + inset), box.bottom - inset),
  };
}

/** Filas de destino de un arrastre (sin la de origen), en orden. */
export function dragTargets(from: number, to: number): number[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i).filter((i) => i !== from);
}
