import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import WorkedDaysGrid from "@/components/novedades/WorkedDaysGrid";
import CollaboratorsView from "@/components/novedades/CollaboratorsView";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";
import type { WorkedDaysMatrix } from "@/components/novedades/types";

// Administración de Días laborados (ver docs/CHANGELOG.md § v1.182.0): el
// Administrador retira (eliminación lógica) y corrige cédulas; nadie más ve
// esas acciones (y Django las rechaza igual por API).

const rules = {
  today: "2026-10-12",
  canBypassDeadline: true,
  workedDays: { hours: 48, earliestOpenDate: "2026-10-08" },
  overtime: { hours: 48, earliestOpenDate: "2026-10-08" },
};

function ctxFor(admin: boolean) {
  return {
    period: "2026-10",
    supervisorId: 6,
    supervisors: [{ id: 6, name: "Sup" }],
    can: (c: string) => c !== "novedades.corregir_cerrado",
    me: { nationalWrite: admin, isAssistant: false, isSupervisor: !admin, user: { id: admin ? 1 : 6, name: "X" }, deadlineRules: rules },
    setDirty: vi.fn(),
    refreshPeriods: vi.fn(),
  } as unknown as ModuleContext;
}

function matrix(): WorkedDaysMatrix {
  return {
    period: { code: "2026-10", label: "Octubre 2026", startDate: "2026-09-23", endDate: "2026-10-22", status: "OPEN", closedAt: null, closedBy: "" },
    supervisor: { id: 6, name: "Sup" },
    editable: true,
    closable: true,
    columns: [{ date: "2026-10-09", day: 9, weekday: "Viernes", isWeekend: false, holiday: "", deadlineState: "", deadlineLabel: "" }],
    rows: [
      { collaboratorId: 5, cedula: "0102030405", fullName: "Ana Pérez", cargo: "", area: "", regional: "", status: "ACTIVE", isCurrentMember: true, cells: { "2026-10-09": { hours: "8", version: 1 } }, totalHours: "8" },
    ],
  } as unknown as WorkedDaysMatrix;
}

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function serve(post: (url: string, body: Record<string, string>) => Response) {
  const calls = { posts: [] as { url: string; body: Record<string, string> }[], gets: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        calls.posts.push({ url: String(url), body });
        return post(String(url), body);
      }
      if (init?.method === "PATCH") return json(200, {});
      calls.gets++;
      return json(200, String(url).includes("worked-days") ? matrix() : []);
    }),
  );
  return calls;
}

function renderGrid(admin: boolean) {
  render(
    <ToastProvider>
      <WorkedDaysGrid ctx={ctxFor(admin)} supervisorId={6} />
    </ToastProvider>,
  );
}

describe("Días laborados — acciones del Administrador", () => {
  it("un Supervisor no ve las acciones de Administrador", async () => {
    serve(() => json(200, {}));
    renderGrid(false);
    expect(await screen.findByText("0102030405")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Corregir cédula/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retirar a Ana Pérez/ })).not.toBeInTheDocument();
  });

  it("retirar pide confirmación con motivo; cancelar no cambia nada", async () => {
    const calls = serve(() => json(200, { id: 5 }));
    renderGrid(true);
    fireEvent.click(await screen.findByRole("button", { name: "Retirar a Ana Pérez de Días laborados" }));
    expect(screen.getByText(/No se borra nada/)).toBeInTheDocument();
    expect(screen.getByText(/cédula 0102030405/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Retirar" });
    expect(confirm).toBeDisabled(); // sin motivo no se puede
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(calls.posts).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Retirar a Ana Pérez de Días laborados" }));
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Registrado por error" } });
    const gets = calls.gets;
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    await waitFor(() =>
      expect(calls.posts).toEqual([{ url: "/api/novedades/collaborators/5/remove-worked-days", body: { reason: "Registrado por error" } }]),
    );
    expect(await screen.findByText("Ana Pérez fue retirado de Días laborados.")).toBeInTheDocument();
    await waitFor(() => expect(calls.gets).toBeGreaterThan(gets)); // la tabla se recarga con el resultado real
  });

  it("corregir cédula: un rechazo del servidor se muestra y no se presenta como guardado", async () => {
    const calls = serve(() => json(409, { error: "La cédula 0999999999 ya pertenece a Otro Equipo (base de Sup Sur): no se guardó el cambio." }));
    renderGrid(true);
    fireEvent.click(await screen.findByRole("button", { name: "Corregir cédula de Ana Pérez" }));
    fireEvent.change(screen.getByLabelText("Cédula correcta"), { target: { value: "0999999999" } });
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Digitación" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cédula" }));
    expect(await screen.findByText(/ya pertenece a Otro Equipo/)).toBeInTheDocument();
    expect(screen.queryByText(/Cédula de Ana Pérez corregida/)).not.toBeInTheDocument();
    expect(calls.posts[0]).toEqual({
      url: "/api/novedades/collaborators/5/cedula",
      body: { cedula: "0999999999", reason: "Digitación" },
    });
  });
});

describe("Base de colaboradores — retiro y cédula", () => {
  const collaborator = (removed: boolean) => ({
    id: 5, cedula: "0102030405", fullName: "Ana Pérez", regional: "", area: "", cargo: "", status: "ACTIVE",
    statusLabel: "Activo", supervisorId: 6, supervisorName: "Sup", createdAt: "", updatedAt: "",
    workedDaysRemovedAt: removed ? "2026-10-16T15:00:00Z" : null, workedDaysRemovedBy: "Admin", workedDaysRemovedReason: "Error",
  });

  function renderBase(admin: boolean, removed: boolean, onPost: (url: string, body: Record<string, string>) => Response = () => json(200, {})) {
    const posts: { url: string; body: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push({ url: String(url), body });
          return onPost(String(url), body);
        }
        if (init?.method === "PATCH") return json(200, {});
        return json(200, [collaborator(removed)]);
      }),
    );
    render(
      <ToastProvider>
        <CollaboratorsView ctx={ctxFor(admin)} />
      </ToastProvider>,
    );
    return posts;
  }

  it("marca al retirado y ofrece restaurarlo solo al Administrador", async () => {
    renderBase(true, true);
    expect(await screen.findByText("Retirado de Días laborados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurar en Días laborados" })).toBeInTheDocument();
  });

  it("un Supervisor no ve Cédula ni Retirar", async () => {
    renderBase(false, false);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cédula" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retirar de Días laborados/ })).not.toBeInTheDocument();
  });

  it("en el formulario de edición el Administrador corrige la cédula con motivo obligatorio", async () => {
    const posts = renderBase(true, false);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const cedula = screen.getAllByRole("textbox")[0];
    expect(cedula).not.toBeDisabled();
    fireEvent.change(cedula, { target: { value: "1712345678" } });
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toBeDisabled(); // falta el motivo
    fireEvent.change(screen.getByText("Motivo de la corrección de cédula").closest("label")!.querySelector("textarea")!, {
      target: { value: "Digitación" },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(posts).toEqual([{ url: "/api/novedades/collaborators/5/cedula", body: { cedula: "1712345678", reason: "Digitación" } }]),
    );
  });
});
