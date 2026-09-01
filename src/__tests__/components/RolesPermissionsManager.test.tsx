import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import RolesPermissionsManager from "@/components/RolesPermissionsManager";
import { ALL_ROLES, ROLE_LABEL, type Role } from "@/lib/roles";

const CATALOG = {
  usuarios: {
    label: "Usuarios",
    description: "Gestión de las cuentas de usuario del sistema.",
    permissions: { "usuarios.ver": "Ver usuarios" },
  },
  roles: {
    label: "Roles",
    description: "Gestión de roles y asignación de permisos por módulo.",
    permissions: { "roles.ver": "Ver roles y el catálogo de permisos", "roles.editar": "Crear, editar y eliminar roles" },
  },
};

function rolesFixture(): { id: string; name: Role; permissionCodenames: string[] }[] {
  return ALL_ROLES.map((name, i) => ({
    id: String(i + 1),
    name,
    permissionCodenames: name === "JEFE_NACIONAL" ? ["roles.ver"] : name === "ADMINISTRADOR" ? ["usuarios.ver", "roles.ver", "roles.editar"] : [],
  }));
}

function mockFetch(overrides: { patchResult?: unknown } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/roles" && (!init || !init.method)) {
      return { ok: true, json: async () => rolesFixture() } as Response;
    }
    if (url === "/api/admin/permissions") {
      return { ok: true, json: async () => CATALOG } as Response;
    }
    if (url.startsWith("/api/admin/roles/") && init?.method === "PATCH") {
      return {
        ok: true,
        json: async () => overrides.patchResult ?? { id: "1", name: "JEFE_NACIONAL", permissionCodenames: JSON.parse(init.body as string).permissionCodenames },
      } as Response;
    }
    throw new Error(`fetch no mockeado: ${url}`);
  });
}

function renderManager(props: Partial<{ canEdit: boolean; currentSessionRole: Role }> = {}) {
  return render(
    <ToastProvider>
      <RolesPermissionsManager canEdit={props.canEdit ?? true} currentSessionRole={props.currentSessionRole ?? "ADMINISTRADOR"} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("RolesPermissionsManager", () => {
  it("renderiza los 11 roles fijos y la matriz agrupada por módulo del rol por defecto (Jefe Nacional)", async () => {
    vi.stubGlobal("fetch", mockFetch());
    renderManager();

    expect(await screen.findByText("Permisos de Jefe Nacional")).toBeInTheDocument();
    for (const role of ALL_ROLES) {
      expect(screen.getByRole("button", { name: ROLE_LABEL[role] })).toBeInTheDocument();
    }
    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByLabelText("Ver roles y el catálogo de permisos")).toBeChecked();
    expect(screen.getByLabelText("Crear, editar y eliminar roles")).not.toBeChecked();
  });

  it("la fila de Administrador se muestra completa y no editable, sin botón Guardar", async () => {
    vi.stubGlobal("fetch", mockFetch());
    renderManager();
    await screen.findByText("Permisos de Jefe Nacional");

    fireEvent.click(screen.getByRole("button", { name: "Administrador" }));

    expect(await screen.findByText("Permisos de Administrador")).toBeInTheDocument();
    expect(screen.getByText(/acceso total al sistema \(superusuario\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ver usuarios")).toBeChecked();
    expect(screen.getByLabelText("Ver usuarios")).toBeDisabled();
    expect(screen.getByLabelText("Crear, editar y eliminar roles")).toBeChecked();
    expect(screen.getByLabelText("Crear, editar y eliminar roles")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });

  it("flujo de guardado: dirty-check habilita Guardar, el modal confirma el conteo y el PATCH envía el set completo", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await screen.findByText("Permisos de Jefe Nacional");

    const guardar = screen.getByRole("button", { name: "Guardar" });
    expect(guardar).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Crear, editar y eliminar roles"));
    expect(guardar).toBeEnabled();

    fireEvent.click(guardar);
    expect(await screen.findByText("Confirmar cambios")).toBeInTheDocument();
    expect(screen.getByText(/con 2 permiso\(s\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Vas a perder acceso/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    const jefeNacionalId = String(ALL_ROLES.indexOf("JEFE_NACIONAL") + 1);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/roles/${jefeNacionalId}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ permissionCodenames: ["roles.ver", "roles.editar"] }),
        })
      )
    );
    expect(await screen.findByText("Guardado correctamente.")).toBeInTheDocument();
  });

  it("advierte autobloqueo al quitarse roles.ver a sí mismo, sin bloquear el guardado", async () => {
    vi.stubGlobal("fetch", mockFetch());
    renderManager({ currentSessionRole: "JEFE_NACIONAL" });
    await screen.findByText("Permisos de Jefe Nacional");

    fireEvent.click(screen.getByLabelText("Ver roles y el catálogo de permisos"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Confirmar cambios")).toBeInTheDocument();
    expect(screen.getByText(/Vas a perder acceso a esta pantalla/)).toBeInTheDocument();
  });

  it("sin permiso de edición (canEdit=false) no muestra Guardar y los checkboxes quedan deshabilitados", async () => {
    vi.stubGlobal("fetch", mockFetch());
    renderManager({ canEdit: false });
    await screen.findByText("Permisos de Jefe Nacional");

    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ver roles y el catálogo de permisos")).toBeDisabled();
  });
});
