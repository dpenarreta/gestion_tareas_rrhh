import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Role } from "@/generated/prisma/client";

const { default: DashboardModule } = await import("@/components/dashboard/DashboardModule");

const DASHBOARD_DATA = {
  workloadPct: 45,
  completedPct: 80,
  overdue: 0,
  priorityTasks: [],
  stats: {
    today: { pending: 0, inProgress: 0, completed: 0 },
    week: { pending: 0, inProgress: 0, completed: 0 },
    month: { pending: 1, inProgress: 2, completed: 3 },
  },
  areaActivity: [],
  teamAlerts: 0,
  announcements: [],
  lastLoginAt: null,
  badges: [],
  upcomingMeetings: [],
  welcomeMessage: "",
  welcomeMessageActive: false,
};

function mockFetch() {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/dashboard") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DASHBOARD_DATA) } as Response);
    }
    if (url === "/api/dashboard/nova-message" && init?.method === "POST") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ message: "Hola" }) } as Response);
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
  });
}

function renderDashboard(overrides: Partial<ComponentProps<typeof DashboardModule>> = {}) {
  return render(
    <DashboardModule
      userId="u1"
      userName="Marco Caguana"
      userRole={"ANALISTA_CC" as Role}
      roleLevel={2}
      initialCardOrder={["jornada", "prioridades", "agenda", "actividad", "comunicados", "acciones", "resumen"]}
      canPost={false}
      canUseDesk={false}
      {...overrides}
    />
  );
}

describe("DashboardModule — carga laboral por rol (Sprint Analytics dirección)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un rol ejecutor (ANALISTA_CC) sí ve su carga laboral personal", async () => {
    renderDashboard({ userRole: "ANALISTA_CC" as Role, roleLevel: 2 });
    await waitFor(() => expect(screen.getAllByText("Carga laboral").length).toBeGreaterThan(0));
    expect(screen.getAllByText("45%").length).toBeGreaterThan(0);
  });

  it("Jefe Nacional NO ve carga laboral personal (Mi jornada ni Resumen)", async () => {
    renderDashboard({ userRole: "JEFE_NACIONAL" as Role, roleLevel: 4 });
    await waitFor(() => expect(screen.getByText(/Buenos días|Buenas tardes|Buenas noches/)).toBeInTheDocument());
    expect(screen.queryByText("Carga laboral")).not.toBeInTheDocument();
    expect(screen.queryByText("45%")).not.toBeInTheDocument();
  });

  it("Administrador NO ve carga laboral personal", async () => {
    renderDashboard({ userRole: "ADMINISTRADOR" as Role, roleLevel: 5 });
    await waitFor(() => expect(screen.getByText(/Buenos días|Buenas tardes|Buenas noches/)).toBeInTheDocument());
    expect(screen.queryByText("Carga laboral")).not.toBeInTheDocument();
  });

  it("Coordinador Nacional (rol de gestión, no de dirección) sigue viendo su carga laboral", async () => {
    renderDashboard({ userRole: "COORDINADOR_NACIONAL" as Role, roleLevel: 3 });
    await waitFor(() => expect(screen.getAllByText("Carga laboral").length).toBeGreaterThan(0));
  });
});
