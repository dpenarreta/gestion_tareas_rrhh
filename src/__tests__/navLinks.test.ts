import { describe, expect, it } from "vitest";
import { getNavLinks, getPageTitle } from "@/lib/navLinks";

function hrefs(role: Parameters<typeof getNavLinks>[0]) {
  return getNavLinks(role).map((l) => l.href);
}

describe("getNavLinks", () => {
  it("un rol de nivel 1 (ASISTENTE_GH) ve 'Mi actividad' pero no 'Equipo', 'Analytics' ni 'Usuarios'", () => {
    const links = hrefs("ASISTENTE_GH");
    expect(links).toContain("/my-kpis");
    expect(links).not.toContain("/team");
    expect(links).not.toContain("/kpis");
    expect(links).not.toContain("/admin/users");
  });

  it("un rol de nivel 2 sin gestión de usuarios (COORDINADOR_ZS) ve Equipo y Analytics pero no Usuarios ni Mi actividad", () => {
    const links = hrefs("COORDINADOR_ZS");
    expect(links).toContain("/team");
    expect(links).toContain("/kpis");
    expect(links).not.toContain("/admin/users");
    expect(links).not.toContain("/my-kpis");
  });

  it("un rol con gestión de usuarios (JEFE_NACIONAL) ve el enlace de Usuarios", () => {
    expect(hrefs("JEFE_NACIONAL")).toContain("/admin/users");
  });

  it("COORDINADOR_NACIONAL también ve el enlace de Usuarios", () => {
    expect(hrefs("COORDINADOR_NACIONAL")).toContain("/admin/users");
  });

  it("solo ADMINISTRADOR ve el enlace de Ajustes", () => {
    expect(hrefs("ADMINISTRADOR")).toContain("/settings");
    expect(hrefs("JEFE_NACIONAL")).not.toContain("/settings");
    expect(hrefs("COORDINADOR_NACIONAL")).not.toContain("/settings");
  });

  it("todos los roles ven Nova seguido de Inteligencia Preventiva al final (sección 'inteligencia')", () => {
    for (const role of ["ASISTENTE_GH", "COORDINADOR_ZS", "JEFE_NACIONAL", "ADMINISTRADOR"] as const) {
      const links = getNavLinks(role);
      expect(links[links.length - 2].href).toBe("/assistant");
      expect(links[links.length - 1].href).toBe("/inteligencia-preventiva");
    }
  });

  it("todos los roles ven Inteligencia Preventiva (Sprint E) — visibilidad individual/equipo se decide dentro del módulo, no en la navegación", () => {
    for (const role of ["ASISTENTE_GH", "COORDINADOR_ZS", "JEFE_NACIONAL", "ADMINISTRADOR"] as const) {
      expect(hrefs(role)).toContain("/inteligencia-preventiva");
    }
  });

  it("todos los roles ven Inicio, Reuniones y Mejora Continua", () => {
    const common = ["/dashboard", "/meetings", "/mejora-continua"];
    for (const role of ["ASISTENTE_GH", "COORDINADOR_ZS", "JEFE_NACIONAL", "ADMINISTRADOR"] as const) {
      const links = hrefs(role);
      for (const href of common) expect(links).toContain(href);
    }
  });

  it("todos los roles excepto JEFE_NACIONAL ven 'Trabajo' (no gestiona tareas propias)", () => {
    for (const role of ["ASISTENTE_GH", "COORDINADOR_ZS", "ADMINISTRADOR"] as const) {
      expect(hrefs(role)).toContain("/tasks");
    }
    expect(hrefs("JEFE_NACIONAL")).not.toContain("/tasks");
  });
});

describe("getPageTitle", () => {
  it("devuelve la etiqueta del enlace en coincidencia exacta", () => {
    expect(getPageTitle("/tasks", "ASISTENTE_GH")).toBe("Trabajo");
  });

  it("devuelve la etiqueta del enlace para una subruta (prefijo)", () => {
    expect(getPageTitle("/tasks/123", "ASISTENTE_GH")).toBe("Trabajo");
  });

  it("no confunde una ruta que solo comparte el prefijo textual (sin '/')", () => {
    // "/tasksomething" no debe coincidir con "/tasks" (no es realmente una subruta)
    expect(getPageTitle("/tasksomething", "ASISTENTE_GH")).toBe("Nexo");
  });

  it("usa EXTRA_TITLES para rutas fuera de la navegación (ej. /profile)", () => {
    expect(getPageTitle("/profile", "ASISTENTE_GH")).toBe("Mi perfil");
  });

  it("devuelve 'Nexo' por defecto para una ruta desconocida", () => {
    expect(getPageTitle("/does-not-exist", "ASISTENTE_GH")).toBe("Nexo");
  });

  it("un enlace visible solo para ciertos roles no aplica a los demás (Usuarios para nivel 1)", () => {
    expect(getPageTitle("/admin/users", "ASISTENTE_GH")).toBe("Nexo");
    expect(getPageTitle("/admin/users", "JEFE_NACIONAL")).toBe("Usuarios");
  });
});
