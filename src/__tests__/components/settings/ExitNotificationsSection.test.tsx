import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import ExitNotificationsSection from "@/components/settings/ExitNotificationsSection";
import StatusChangeDialog from "@/components/novedades/StatusChangeDialog";

// Notificaciones de salida de colaboradores (ver docs/CHANGELOG.md § v1.176.0):
// el Administrador administra los destinatarios en Ajustes y el cambio de
// estado distingue "cambio confirmado" del estado del correo.

const AREAS = [
  { value: "OPERACIONES", label: "Operaciones" },
  { value: "JEFATURA_OPERACIONES", label: "Jefatura de Operaciones" },
  { value: "TALENTO_HUMANO", label: "Talento Humano" },
];

function json(code: number, body: unknown) {
  return { ok: code < 400, status: code, json: async () => body } as Response;
}

function config(recipients: unknown[], activeCount: number) {
  return { recipients, activeCount, delivery: "smtp", areas: AREAS };
}

const FAILED_EVENT = {
  id: 7,
  collaborator: { id: 3, cedula: "0102030405", fullName: "Ana Pérez" },
  supervisor: "Sup Norte",
  changedBy: "Sup Norte",
  changedAt: "2026-10-13T15:00:00Z",
  period: "Octubre 2026",
  status: "FAILED",
  statusLabel: "Fallido",
  recipients: [],
  attempts: 1,
  lastAttemptAt: "2026-10-13T15:00:01Z",
  lastError: "No hay destinatarios activos configurados en Ajustes.",
  sentAt: null,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function open() {
  render(
    <ToastProvider>
      <ExitNotificationsSection />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Notificaciones de salida de colaboradores/ }));
}

describe("ExitNotificationsSection", () => {
  it("avisa que no hay destinatarios activos y agrega uno con su área", async () => {
    const posts: unknown[] = [];
    let recipients: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push(body);
          recipients = [{ id: 1, email: body.email.trim().toLowerCase(), area: body.area, areaLabel: "Talento Humano", isActive: true, updatedAt: "", updatedBy: "Admin" }];
          return json(201, recipients[0]);
        }
        if (String(url).includes("recipients")) return json(200, config(recipients, recipients.length));
        return json(200, [FAILED_EVENT]);
      }),
    );
    await open();
    expect(await screen.findByText(/las salidas se registran, pero ningún correo se envía/)).toBeInTheDocument();
    expect(screen.getByText("Fallido")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("nombre@empresa.com"), { target: { value: "TH@Empresa.com" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TALENTO_HUMANO" } });
    fireEvent.click(screen.getByRole("button", { name: /Agregar destinatario/ }));
    await waitFor(() => expect(posts).toEqual([{ email: "TH@Empresa.com", area: "TALENTO_HUMANO" }]));
    expect(await screen.findByText("th@empresa.com")).toBeInTheDocument();
    expect(screen.getByText("1 destinatario(s) activo(s)")).toBeInTheDocument();
  });

  it("desactiva un destinatario sin borrarlo y muestra el error del servidor", async () => {
    const patches: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push({ url: String(url), body: JSON.parse(String(init.body)) });
          return json(409, { error: "x@empresa.com ya está registrado como destinatario." });
        }
        if (String(url).includes("recipients"))
          return json(200, config([{ id: 4, email: "ops@empresa.com", area: "OPERACIONES", areaLabel: "Operaciones", isActive: true, updatedAt: "", updatedBy: "Admin" }], 1));
        return json(200, []);
      }),
    );
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(patches).toEqual([{ url: "/api/novedades/exit-notifications/recipients/4", body: { isActive: false } }]));
    expect(await screen.findByText(/ya está registrado como destinatario/)).toBeInTheDocument();
  });

  it("sin permiso muestra el error de Django y no la configuración", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: "Solo el Administrador puede gestionar las notificaciones de salida." })));
    await open();
    expect(await screen.findByText(/Solo el Administrador/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar destinatario/ })).not.toBeInTheDocument();
  });
});

describe("StatusChangeDialog — notificación de salida", () => {
  function renderDialog() {
    const onDone = vi.fn();
    render(
      <ToastProvider>
        <StatusChangeDialog collaborator={{ id: 3, fullName: "Ana Pérez", status: "ACTIVE" }} onClose={vi.fn()} onDone={onDone} />
      </ToastProvider>,
    );
    return onDone;
  }

  async function inactivate() {
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "INACTIVE" } });
    expect(screen.getByText(/se enviará por correo la notificación de salida/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renuncia" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cambio/ }));
  }

  it("confirma el cambio y muestra el correo como pendiente, no como enviado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { id: 3, status: "INACTIVE", exitNotification: { id: 9, status: "PENDING" } })));
    const onDone = renderDialog();
    await inactivate();
    expect(await screen.findByText(/Cambio de estado confirmado: Ana Pérez — Inactivo\. Notificación pendiente de envío\./)).toBeInTheDocument();
    expect(screen.queryByText(/Notificación enviada/)).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("una falla del correo no se presenta como falla del cambio de estado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { id: 3, status: "INACTIVE", exitNotification: { id: 9, status: "FAILED" } })));
    const onDone = renderDialog();
    await inactivate();
    expect(await screen.findByText(/Cambio de estado confirmado.*Error en la notificación/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });
});
