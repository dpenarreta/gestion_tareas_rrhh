import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ActivityItem from "@/components/tasks/ActivityItem";
import type { TaskActivity } from "@/components/tasks/types";
import type { ActivityReasonConfig } from "@/components/tasks/activityReasons";

/**
 * Borrar una actividad pedía confirmación en ninguna parte: el icono de
 * papelera llamaba al DELETE directo. A diferencia de tareas, notas y
 * proyectos, las actividades NO tienen papelera, así que un clic accidental
 * borraba horas ya registradas sin vuelta atrás y sin aviso.
 */

const MOTIVOS: ActivityReasonConfig[] = [
  {
    id: "1",
    key: "REUNION",
    label: "Reunión",
    description: null,
    isActive: true,
    isArchived: false,
    archivedAt: null,
    assignedRoles: [],
  },
];

const AUTOR = { id: "u1", name: "Quien la registró" };

function actividad(): TaskActivity {
  return {
    id: "act-1",
    reason: "REUNION" as TaskActivity["reason"],
    startTime: null,
    endTime: null,
    duration: 90,
    description: "Revisión del plan",
    isRetroactive: false,
    activityDate: null,
    adminComment: null,
    modifiedByAdmin: false,
    modifiedAt: null,
    author: AUTOR,
    createdAt: "2026-09-29T14:00:00.000Z",
    _count: { comments: 0 },
  };
}

function montar(onDeleted = vi.fn()) {
  render(
    <ActivityItem
      activity={actividad()}
      taskId="task-1"
      currentUserId={AUTOR.id}
      reasons={MOTIVOS}
      onDeleted={onDeleted}
      onUpdated={vi.fn()}
    />
  );
  return onDeleted;
}

function botonPapelera() {
  return screen.getByTitle("Eliminar actividad");
}

describe("Borrado de una actividad", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch;
  });

  it("el clic en la papelera NO borra: primero pide confirmación", async () => {
    montar();

    fireEvent.click(botonPapelera());

    expect(await screen.findByText("Eliminar actividad", { selector: "h2,h3,p,span,div" })).toBeTruthy();
    // Lo reportado: el DELETE salía en el mismo clic, sin preguntar nada.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("el diálogo dice qué se pierde — el motivo y las horas, no un '¿estás seguro?' genérico", async () => {
    montar();

    fireEvent.click(botonPapelera());

    // El motivo aparece también en la fila de la actividad, así que se
    // consulta el párrafo del diálogo, no cualquier "Reunión" de la pantalla.
    const mensaje = await screen.findByText(/¿Eliminar la actividad/);
    expect(mensaje.textContent).toContain("Reunión");
    expect(mensaje.textContent).toContain("1h 30min");
    expect(mensaje.textContent).toMatch(/no se puede deshacer/i);
  });

  it("confirmar sí dispara el DELETE y avisa al padre", async () => {
    const onDeleted = montar();

    fireEvent.click(botonPapelera());
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("act-1"));
    expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-1/activities/act-1", { method: "DELETE" });
  });

  it("cancelar deja la actividad intacta", async () => {
    const onDeleted = montar();

    fireEvent.click(botonPapelera());
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull());
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("quien no es el autor no ve la papelera", () => {
    render(
      <ActivityItem
        activity={actividad()}
        taskId="task-1"
        currentUserId="otra-persona"
        reasons={MOTIVOS}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />
    );

    expect(screen.queryByTitle("Eliminar actividad")).toBeNull();
  });
});
