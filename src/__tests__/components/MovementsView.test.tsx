import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import MovementsView from "@/components/novedades/MovementsView";
import MovementPermissionsSection from "@/components/settings/MovementPermissionsSection";
import { getNavLinks, getPageTitle, MOVEMENTS_HOME } from "@/lib/navLinks";

// Ingresos y Salidas (ver docs/CHANGELOG.md § v1.177.0): pestañas según los
// permisos individuales; consulta paginada con filtros en el servidor.

function json(code: number, body: unknown) {
  return { ok: code < 400, status: code, json: async () => body } as Response;
}

const OPTIONS = {
  supervisors: [{ id: 10, name: "Jose Andaluz" }],
  cargos: ["Courier"],
  statuses: [
    { value: "ACTIVE", label: "Activo" },
    { value: "INACTIVE", label: "Inactivo" },
  ],
};

const ENTRY = {
  id: "A1",
  kind: "ALTA",
  kindLabel: "Alta en NEXO",
  registeredAt: "2026-10-12T15:00:00Z",
  cedula: "0102030405",
  fullName: "Ana Pérez",
  cargo: "Courier",
  area: "",
  regional: "Sierra",
  supervisor: "Jose Andaluz",
  status: "ACTIVE",
  statusLabel: "Activo",
  registeredBy: "Jose Andaluz",
  origin: "Importación (base.xlsx)",
};

function page(results: unknown[], count: number, extra: Record<string, number> = {}) {
  return { results, count, page: 1, pageSize: 25, counters: { movements: count, people: count, ...extra } };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("MovementsView", () => {
  it("muestra solo la pestaña autorizada y consulta con los filtros", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("movements/options")) return json(200, OPTIONS);
        return json(200, page([ENTRY], 26, { altas: 25, reingresos: 1 }));
      }),
    );
    render(<MovementsView access={{ entries: true, exits: false, canManage: false }} />);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ingresos" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Salidas" })).not.toBeInTheDocument();
    expect(screen.getByText("Fecha de registro en NEXO")).toBeInTheDocument();
    expect(screen.getByText("Personas distintas")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();

    await screen.findByRole("option", { name: "Jose Andaluz" });
    fireEvent.change(screen.getByLabelText("Filtrar por supervisor"), { target: { value: "10" } });
    await waitFor(() => expect(urls.some((u) => u.includes("supervisor=10"))).toBe(true));
    expect(screen.getByText("Supervisor: Jose Andaluz")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.some((u) => u.includes("page=2"))).toBe(true));
  });

  it("la pestaña Salidas usa la etiqueta de cambio a Inactivo y tiene estado vacío", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).includes("options") ? json(200, OPTIONS) : json(200, page([], 0)))),
    );
    render(<MovementsView access={{ entries: false, exits: true, canManage: false }} />);
    expect(await screen.findByText("Todavía no hay salidas registradas.")).toBeInTheDocument();
    expect(screen.getByText(/no acredita por sí misma una desvinculación laboral formal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar a Excel/ })).toBeDisabled();
  });

  it("muestra el error del servidor si se retiró el permiso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("options") ? json(200, OPTIONS) : json(403, { error: "No tiene acceso a la consulta de Ingresos." }),
      ),
    );
    render(<MovementsView access={{ entries: true, exits: true, canManage: true }} />);
    expect(await screen.findByText("No tiene acceso a la consulta de Ingresos.")).toBeInTheDocument();
  });
});

describe("MovementPermissionsSection", () => {
  const USERS = [
    { id: 5, name: "Laura Torres", username: "ltorres", email: "lt@empresa.com", role: "ANALISTA_CC", isActive: true, entries: { direct: false, byRole: false }, exits: { direct: false, byRole: true } },
    { id: 6, name: "Pedro Gil", username: "pgil", email: "pg@empresa.com", role: "ASISTENTE_GH", isActive: true, entries: { direct: true, byRole: false }, exits: { direct: false, byRole: false } },
  ];

  it("guarda cada pestaña por separado y solo lo que cambió", async () => {
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
          return json(200, { ...USERS[0], entries: { direct: true, byRole: false } });
        }
        return json(200, USERS);
      }),
    );
    render(
      <ToastProvider>
        <MovementPermissionsSection />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Permisos de visibilidad — Ingresos y Salidas/ }));
    expect(await screen.findByText("Laura Torres")).toBeInTheDocument();
    expect(screen.getByText("por su rol")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar usuario"), { target: { value: "laura" } });
    expect(screen.queryByText("Pedro Gil")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Ingresos para Laura Torres"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(posts).toEqual([{ url: "/api/novedades/movements/permissions/5", body: { entries: true } }]));
    expect(await screen.findByText("Permisos de Laura Torres guardados.")).toBeInTheDocument();
  });
});

describe("navegación de Ingresos y Salidas", () => {
  const has = (links: { href: string }[]) => links.some((l) => l.href === MOVEMENTS_HOME);

  it("el Administrador la ve por su rol", () => {
    expect(has(getNavLinks("ADMINISTRADOR", ["*"]))).toBe(true);
  });

  it("otros roles solo con el permiso individual, sin ampliar el resto del menú", () => {
    const base = getNavLinks("ANALISTA_CC", []);
    const withPerm = getNavLinks("ANALISTA_CC", ["novedades.salidas_ver"]);
    expect(has(base)).toBe(false);
    expect(has(withPerm)).toBe(true);
    expect(withPerm.filter((l) => l.href !== MOVEMENTS_HOME)).toEqual(base);
    expect(has(getNavLinks("SUPERVISOR_OPERACIONES", ["novedades.ingresos_ver"]))).toBe(true);
    expect(has(getNavLinks("SUPERVISOR_OPERACIONES", []))).toBe(false);
  });

  it("el título de la página no se confunde con el del módulo", () => {
    expect(getPageTitle(MOVEMENTS_HOME, "ADMINISTRADOR")).toBe("Ingresos y Salidas");
    expect(getPageTitle("/control-operativo", "ADMINISTRADOR")).toBe("Control Operativo");
  });
});
