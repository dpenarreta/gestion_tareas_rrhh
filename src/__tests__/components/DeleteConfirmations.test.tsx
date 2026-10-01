import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import ProjectParticipantsTab from "@/components/projects/ProjectParticipantsTab";
import RemindersPanel from "@/components/desk/RemindersPanel";
import type { ProjectParticipant } from "@/components/projects/types";
import type { PersonalReminder } from "@/components/desk/types";

/**
 * Auditoría de los 16 puntos de borrado del frontend (2026-10-01): cinco
 * llamaban al `DELETE` directo desde el `onClick`, sin confirmación. Acá se
 * cubren los que son aislables en un test; el de actividades tiene su propio
 * archivo (`ActivityDeleteConfirm.test.tsx`).
 */

// --- Participantes de un proyecto -------------------------------------------

const PARTICIPANTE: ProjectParticipant = {
  id: "p1",
  userId: "u2",
  user: { id: "u2", name: "Persona Participante", role: "ASISTENTE_GH" },
  addedAt: "2026-09-01T10:00:00.000Z",
  addedBy: { id: "u1", name: "Quien la agregó" },
};

function montarParticipantes(onChanged = vi.fn()) {
  render(
    <ToastProvider>
      <ProjectParticipantsTab
        projectId="proj-1"
        participants={[PARTICIPANTE]}
        responsibleId="u1"
        canManage
        candidateUsers={[]}
        onParticipantsChanged={onChanged}
      />
    </ToastProvider>
  );
  return onChanged;
}

describe("Quitar un participante de un proyecto", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch;
  });

  it("el clic en «Quitar» no quita: primero pide confirmación", async () => {
    montarParticipantes();

    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));

    expect(await screen.findByText(/¿Quitar a Persona Participante/)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirmar sí llama al DELETE", async () => {
    const onChanged = montarParticipantes();

    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    // El del diálogo, no el de la fila: el diálogo se monta después.
    const botones = await screen.findAllByRole("button", { name: "Quitar" });
    fireEvent.click(botones[botones.length - 1]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/projects/proj-1/participants/p1", { method: "DELETE" })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith([]));
  });

  it("cancelar no toca nada", async () => {
    const onChanged = montarParticipantes();

    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByText(/¿Quitar a/)).toBeNull());
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// --- Recordatorios personales ------------------------------------------------

const RECORDATORIO: PersonalReminder = {
  id: "r1",
  title: "Llamar a la aseguradora",
  description: null,
  dueAt: "2026-10-02T15:00:00.000Z",
  priority: "MEDIA",
  status: "PENDIENTE",
  repeat: "UNA_VEZ",
  completedAt: null,
  archived: false,
  convertedToTaskId: null,
  convertedToTaskAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
};

function mockFetchRecordatorios() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/desk-reminders") && (!init || !init.method)) {
      return { ok: true, json: async () => [RECORDATORIO] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe("Eliminar un recordatorio personal", () => {
  beforeEach(() => {
    global.fetch = mockFetchRecordatorios() as unknown as typeof fetch;
  });

  it("el clic en la papelera no borra: primero pide confirmación", async () => {
    render(
      <ToastProvider>
        <RemindersPanel />
      </ToastProvider>
    );

    fireEvent.click(await screen.findByTitle("Eliminar"));

    // Django hace `reminder.delete()`: no hay papelera que lo rescate.
    const mensaje = await screen.findByText(/No hay papelera de recordatorios/);
    expect(mensaje.textContent).toContain("Llamar a la aseguradora");
    const deletes = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "DELETE"
    );
    expect(deletes).toHaveLength(0);
  });

  it("confirmar sí llama al DELETE", async () => {
    render(
      <ToastProvider>
        <RemindersPanel />
      </ToastProvider>
    );

    fireEvent.click(await screen.findByTitle("Eliminar"));
    // El icono de la tarjeta también se llama "Eliminar"; el del diálogo es el
    // último en montarse.
    const botones = await screen.findAllByRole("button", { name: "Eliminar" });
    fireEvent.click(botones[botones.length - 1]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/desk-reminders/r1", { method: "DELETE" })
    );
  });
});
