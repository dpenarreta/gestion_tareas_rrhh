import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { default: TasksModule } = await import("@/components/tasks/TasksModule");

// Clases de Tailwind que crean un contexto de recorte. `overflow-x-auto` recorta
// también en vertical: al declarar un eje distinto de `visible`, CSS computa el
// otro como `auto`. Un panel flotante bajo uno de estos ancestros queda cortado.
const RECORTA = /\boverflow(-[xy])?-(auto|scroll|hidden|clip)\b/;

function renderModule() {
  return render(
    <TasksModule
      initialTasks={[]}
      initialViews={["KANBAN", "TABLA"]}
      initialUsers={[]}
      currentUserId="1"
      currentUserRole="ASISTENTE_GH"
      currentActivityFormat="duration"
    />
  );
}

describe("TasksModule — barra de vistas", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
    ) as unknown as typeof fetch;
  });

  it("el panel de agregar vista no queda bajo un ancestro que lo recorte", () => {
    const { container } = renderModule();

    fireEvent.click(screen.getByRole("button", { name: /^\+?\s*vista$/i }));

    const panel = screen.getByText("Agregar vista").closest("div.absolute");
    expect(panel).not.toBeNull();

    // Regresión: el panel vivía dentro del contenedor `overflow-x-auto` de las
    // pestañas, que lo recortaba por completo. Quedaba imposible reabrir una
    // vista cerrada, porque este panel es el único camino para volver a
    // agregarla. Ver docs/AUDIT_LOG.md § 2026-09-15.
    const culpables: string[] = [];
    for (let n = panel!.parentElement; n && n !== container; n = n.parentElement) {
      if (RECORTA.test(n.className)) culpables.push(n.className);
    }
    expect(culpables).toEqual([]);
  });

  it("las pestañas conservan su scroll horizontal", async () => {
    const { container } = renderModule();

    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller).not.toBeNull();
    // El arreglo no debe lograrse quitando el scroll: con muchas vistas la barra
    // tiene que seguir desplazándose en pantallas angostas.
    expect(scroller!.textContent).toContain("Kanban");
    expect(scroller!.textContent).toContain("Tabla");
  });

  it("ofrece cerrar cada vista mientras haya más de una", () => {
    renderModule();

    expect(screen.getByRole("button", { name: "Cerrar Kanban" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cerrar Tabla" })).toBeDefined();
  });
});
