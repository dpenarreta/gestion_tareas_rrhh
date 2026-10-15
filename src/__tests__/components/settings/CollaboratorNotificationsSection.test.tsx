import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import CollaboratorNotificationsSection from "@/components/settings/CollaboratorNotificationsSection";
import StatusChangeDialog from "@/components/novedades/StatusChangeDialog";

// Notificaciones de colaboradores (ver docs/CHANGELOG.md § v1.178.0): dos
// listas independientes (ingreso y salida) que administra el Administrador, y
// el cambio de estado distingue "cambio confirmado" del estado del correo.

const AREAS = [
  { value: "OPERACIONES", label: "Operaciones" },
  { value: "JEFATURA_OPERACIONES", label: "Jefatura de Operaciones" },
  { value: "TALENTO_HUMANO", label: "Talento Humano" },
];

function json(code: number, body: unknown) {
  return { ok: code < 400, status: code, json: async () => body } as Response;
}

function recipient(id: number, kind: "ENTRY" | "EXIT", email: string, isActive = true) {
  return { id, kind, email, area: "", areaLabel: "", isActive, updatedAt: "", updatedBy: "Admin" };
}

function config(recipients: ReturnType<typeof recipient>[]) {
  const count = (k: string) => recipients.filter((r) => r.kind === k && r.isActive).length;
  return { recipients, activeCount: { ENTRY: count("ENTRY"), EXIT: count("EXIT") }, delivery: "smtp", areas: AREAS };
}

const ENTRY_EVENT = {
  id: 7,
  kind: "ENTRY",
  collaborator: { id: 3, cedula: "0102030405", fullName: "Ana Pérez" },
  supervisor: "Sup Norte",
  changedBy: "Sup Norte",
  changedAt: "2026-10-13T15:00:00Z",
  createdAt: "2026-10-08T15:00:00Z",
  firstDay: "2026-10-08",
  secondDay: "2026-10-09",
  period: "Octubre 2026",
  status: "FAILED",
  statusLabel: "Fallido",
  recipients: [
    { email: "ops@empresa.com", status: "SENT", sentAt: "2026-10-13T15:00:01Z", error: "" },
    { email: "th@empresa.com", status: "FAILED", sentAt: null, error: "SMTPServerDisconnected" },
  ],
  attempts: 1,
  lastError: "1 de 2 destinatario(s) sin enviar.",
  sentAt: null,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function open() {
  render(
    <ToastProvider>
      <CollaboratorNotificationsSection />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Notificaciones de colaboradores/ }));
}

describe("CollaboratorNotificationsSection", () => {
  it("muestra dos listas independientes y agrega a la lista de ingresos", async () => {
    const posts: unknown[] = [];
    let recipients = [recipient(1, "EXIT", "jefatura@empresa.com")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && String(url).includes("recipients")) {
          const body = JSON.parse(String(init.body));
          posts.push(body);
          const created = recipient(2, body.kind, body.email.toLowerCase());
          recipients = [...recipients, created];
          return json(201, created);
        }
        if (String(url).includes("recipients")) return json(200, config(recipients));
        return json(200, [ENTRY_EVENT]);
      }),
    );
    await open();
    const entry = await screen.findByRole("region", { name: /Destinatarios de notificaciones de ingreso/ });
    const exit = screen.getByRole("region", { name: /Destinatarios de notificaciones de salida/ });
    expect(within(exit).getByText("jefatura@empresa.com")).toBeInTheDocument();
    expect(within(entry).queryByText("jefatura@empresa.com")).not.toBeInTheDocument();
    expect(within(entry).getByText(/Sin destinatarios activos/)).toBeInTheDocument();

    fireEvent.change(within(entry).getByLabelText("Nuevo correo de ingreso"), { target: { value: "jefatura@empresa.com" } });
    fireEvent.click(within(entry).getByRole("button", { name: "Agregar" }));
    await waitFor(() => expect(posts).toEqual([{ kind: "ENTRY", email: "jefatura@empresa.com", area: "" }]));
    // La misma dirección queda en ambas listas, cada una por su lado.
    expect(await within(entry).findByText("jefatura@empresa.com")).toBeInTheDocument();
    expect(within(exit).getByText("jefatura@empresa.com")).toBeInTheDocument();
  });

  it("lista los envíos con su tipo y el estado por destinatario, y reintenta el mismo evento", async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(String(url));
          return json(200, { ...ENTRY_EVENT, status: "SENT", statusLabel: "Enviado", lastError: "" });
        }
        if (String(url).includes("recipients")) return json(200, config([recipient(1, "ENTRY", "ops@empresa.com")]));
        return json(200, [ENTRY_EVENT]);
      }),
    );
    await open();
    expect(await screen.findByText("Ingreso")).toBeInTheDocument();
    expect(screen.getByText(/2\.º día: 09\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/✓ ops@empresa.com/)).toBeInTheDocument();
    expect(screen.getByText(/✗ th@empresa.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(posts).toEqual(["/api/novedades/collaborator-notifications/events/ENTRY/7/retry"]));
    expect(await screen.findByText("Notificación enviada.")).toBeInTheDocument();
  });

  it("sin permiso muestra el error de Django y no la configuración", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(403, { error: "Solo el Administrador puede gestionar las notificaciones de colaboradores." })),
    );
    await open();
    expect(await screen.findByText(/Solo el Administrador/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar" })).not.toBeInTheDocument();
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
