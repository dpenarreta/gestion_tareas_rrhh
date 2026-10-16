"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { autoScrollStep, clampToBox, type Point } from "@/lib/dragFill";

export type DragState = { col: number; from: number; to: number };

const nextFrame = (cb: () => void): number =>
  typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(cb) : window.setTimeout(cb, 16);
const cancelFrame = (id: number) =>
  typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(id) : window.clearTimeout(id);

/** Arrastre del controlador de relleno (tipo Excel), compartido por Horas
 * extras y Días laborados.
 *
 * - El rango vive solo en el frontend mientras se arrastra: nada se envía al
 *   servidor hasta soltar (`onCommit`), y entonces cada módulo aplica sus
 *   propias reglas a CADA celda y guarda con su mecanismo habitual.
 * - Desplazamiento automático: cerca de un borde del contenedor de la tabla
 *   (o fuera de él), el contenedor se desplaza solo, más rápido cuanto más
 *   cerca del borde, y el rango sigue a las filas que van apareciendo. Se
 *   desplaza el CONTENEDOR, nunca la página.
 * - Termina al soltar; Escape o perder el foco de la ventana lo cancelan.
 *
 * Las filas se identifican con un atributo (`data-row` por defecto) dentro
 * del contenedor. */
export function useDragFill({
  containerRef,
  onCommit,
  rowAttr = "data-row",
}: {
  containerRef: RefObject<HTMLElement | null>;
  onCommit: (drag: DragState) => void;
  rowAttr?: string;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointer = useRef<Point | null>(null);
  const frame = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  const rowAt = useCallback(
    (p: Point): number | null => {
      const container = containerRef.current;
      if (!container) return null;
      const box = container.getBoundingClientRect();
      const { x, y } = clampToBox(p, box);
      // El encabezado es fijo (sticky) DENTRO del contenedor: en el borde
      // superior, `elementFromPoint` devuelve su celda y no la fila que tapa.
      // `elementsFromPoint` da toda la pila bajo el punto; se toma la primera
      // fila, así el rango sigue a las filas que aparecen al subir.
      const hits =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(x, y)
          : typeof document.elementFromPoint === "function"
            ? [document.elementFromPoint(x, y)]
            : [];
      for (const hit of hits) {
        const el = hit?.closest<HTMLElement>(`[${rowAttr}]`);
        if (!el || !container.contains(el)) continue; // encabezado u otra tabla
        const row = Number(el.getAttribute(rowAttr));
        if (Number.isFinite(row)) return row;
      }
      return null;
    },
    [containerRef, rowAttr],
  );

  const retarget = useCallback(() => {
    const current = dragRef.current;
    if (!current || !pointer.current) return;
    const to = rowAt(pointer.current);
    if (to !== null && to !== current.to) {
      dragRef.current = { ...current, to };
      setDrag(dragRef.current);
    }
  }, [rowAt]);

  /** Un cuadro del desplazamiento automático; devuelve si sigue arrastrando. */
  const scrollStep = useCallback((): boolean => {
    const container = containerRef.current;
    if (!dragRef.current || !container || !pointer.current) return false;
    const { dx, dy } = autoScrollStep(pointer.current, container.getBoundingClientRect());
    if (dx || dy) {
      const before = { top: container.scrollTop, left: container.scrollLeft };
      container.scrollTop += dy;
      container.scrollLeft += dx;
      if (container.scrollTop !== before.top || container.scrollLeft !== before.left) retarget();
    }
    return true;
  }, [containerRef, retarget]);

  const finish = useCallback((apply: boolean) => {
    cleanup.current?.();
    cleanup.current = null;
    if (frame.current !== null) cancelFrame(frame.current);
    frame.current = null;
    const current = dragRef.current;
    dragRef.current = null;
    pointer.current = null;
    setDrag(null);
    if (apply && current && current.to !== current.from) commitRef.current(current);
  }, []);

  const start = useCallback(
    (e: ReactMouseEvent, row: number, col: number) => {
      e.preventDefault(); // sin selección de texto ni arrastre nativo
      e.stopPropagation();
      finish(false);
      dragRef.current = { col, from: row, to: row };
      pointer.current = { x: e.clientX, y: e.clientY };
      setDrag(dragRef.current);
      const onMove = (ev: MouseEvent) => {
        pointer.current = { x: ev.clientX, y: ev.clientY };
        retarget();
      };
      const onUp = () => finish(true);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") finish(false);
      };
      const onBlur = () => finish(false);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", onBlur);
      cleanup.current = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onBlur);
      };
      // Mientras dura el arrastre, un cuadro tras otro (aunque el puntero no
      // se mueva): así la tabla sigue desplazándose con el puntero quieto en
      // el borde.
      const loop = () => {
        frame.current = scrollStep() ? nextFrame(loop) : null;
      };
      frame.current = nextFrame(loop);
    },
    [finish, retarget, scrollStep],
  );

  useEffect(() => () => finish(false), [finish]);

  const inDrag = (row: number, col: number) =>
    drag !== null && drag.col === col && row >= Math.min(drag.from, drag.to) && row <= Math.max(drag.from, drag.to);

  return { drag, start, cancel: () => finish(false), inDrag };
}
