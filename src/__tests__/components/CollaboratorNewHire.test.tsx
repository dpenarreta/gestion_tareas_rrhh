import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import CollaboratorsView from "@/components/novedades/CollaboratorsView";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";

// Casilla "Es un nuevo ingreso" del alta (ver docs/CHANGELOG.md § v1.178.0):
// solo esas altas generan el correo de ingreso; por defecto NO está marcada.

const ctx = {
  period: "2026-10",
  supervisorId: 6,
  supervisors: [{ id: 6, name: "Sup Norte" }],
  can: () => true,
  me: { nationalWrite: false, nationalRead: false, isSupervisor: true, user: { id: 6, name: "Sup Norte" } },
  setDirty: vi.fn(),
  refreshPeriods: vi.fn(),
} as unknown as ModuleContext;

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

afterEach(() => vi.unstubAllGlobals());

async function submit(markNewHire: boolean) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return json(201, { id: 1 });
      }
      return json(200, []);
    }),
  );
  render(
    <ToastProvider>
      <CollaboratorsView ctx={ctx} />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Agregar colaborador/ }));
  const inputs = screen.getAllByRole("textbox");
  fireEvent.change(inputs[0], { target: { value: "0102030405" } });
  fireEvent.change(inputs[1], { target: { value: "Ana Pérez" } });
  const box = screen.getByRole("checkbox", { name: /Es un nuevo ingreso/ });
  expect(box).not.toBeChecked();
  if (markNewHire) fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  return bodies[0];
}

describe("Alta de colaborador — nuevo ingreso", () => {
  it("envía isNewHire=true solo si se marca la casilla", async () => {
    expect(await submit(true)).toMatchObject({ cedula: "0102030405", fullName: "Ana Pérez", isNewHire: true });
  });

  it("por defecto el alta no es un nuevo ingreso", async () => {
    expect(await submit(false)).toMatchObject({ isNewHire: false });
  });
});
