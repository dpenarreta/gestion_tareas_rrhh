import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import OvertimeMonthBanner, { formatRemaining } from "@/components/novedades/OvertimeMonthBanner";
import type { ModuleContext } from "@/components/novedades/NovedadesModule";
import type { OvertimeMonth } from "@/components/novedades/types";

// Estado del mes de Horas extras (mes calendario + plazo de 48–72 h laborables).
// Todo viene calculado por Django; "vencido" no bloquea (no hay cierre
// automático) y solo "cerrado" deja el mes en solo lectura. Ver
// docs/CHANGELOG.md § v1.172.0.

const BASE: OvertimeMonth = {
  code: "2026-10",
  label: "Octubre 2026",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  status: "GRACE",
  graceHours: 48,
  deadline: "2026-11-04T05:00:00Z",
  deadlineLabel: "martes 03/11/2026 23:59",
  remainingSeconds: 14 * 3600,
  closingSoon: true,
  closedAt: null,
  closedBy: "",
};

function ctx(perms: string[] = ["novedades.cerrar_periodo"], refresh = vi.fn()) {
  return {
    can: (c: string) => perms.includes(c),
    me: { isAssistant: false },
    refreshOvertimeMonths: refresh,
  } as unknown as ModuleContext;
}

function renderBanner(month: OvertimeMonth, context = ctx(), supervisorId: number | null = 6) {
  return render(
    <ToastProvider>
      <OvertimeMonthBanner ctx={context} month={month} supervisorId={supervisorId} />
    </ToastProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("OvertimeMonthBanner", () => {
  it("en plazo: muestra la fecha límite exacta, el tiempo restante y el aviso de cierre próximo", () => {
    renderBanner(BASE);
    expect(screen.getByRole("status")).toHaveTextContent("Horas extras Octubre 2026: en plazo de cierre");
    expect(screen.getByText("martes 03/11/2026 23:59")).toBeInTheDocument();
    expect(screen.getByText(/quedan 14 h 0 min/)).toBeInTheDocument();
    expect(screen.getByText(/Plazo próximo a vencer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cerrar mes/ })).toBeInTheDocument();
  });

  it("vencido: avisa pero NO dice que está cerrado (el servidor todavía permite editar)", () => {
    renderBanner({ ...BASE, status: "OVERDUE", remainingSeconds: 0, closingSoon: false });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("plazo vencido, sin cerrar");
    expect(status).toHaveTextContent("Todavía se puede editar");
    expect(status).not.toHaveTextContent("Solo lectura");
  });

  it("cerrado: solo lectura, quién y cuándo, sin botón de cierre", () => {
    renderBanner({ ...BASE, status: "CLOSED", closedBy: "Carlos Norte", closedAt: "2026-11-03T20:00:00Z" });
    expect(screen.getByRole("status")).toHaveTextContent("Solo lectura: cerrado por Carlos Norte");
    expect(screen.queryByRole("button", { name: /Cerrar mes/ })).not.toBeInTheDocument();
  });

  it("mes en curso o sin permiso de cierre: no ofrece cerrar", () => {
    const { unmount } = renderBanner({ ...BASE, status: "OPEN", closingSoon: false });
    expect(screen.queryByRole("button", { name: /Cerrar mes/ })).not.toBeInTheDocument();
    unmount();
    renderBanner(BASE, ctx([]));
    expect(screen.queryByRole("button", { name: /Cerrar mes/ })).not.toBeInTheDocument();
  });

  it("cierra el mes con una sola solicitud aunque se haga doble clic", async () => {
    let resolve!: (r: Response) => void;
    const closeCalls: [string, RequestInit][] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/novedades/overtime/months/check")) {
        // Revisión previa al cierre (solo lectura).
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ records: 2, errors: 0, warnings: 0, issues: [] }),
        } as Response);
      }
      closeCalls.push([url, init ?? {}]);
      return new Promise<Response>((r) => (resolve = r));
    });
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn();
    renderBanner(BASE, ctx(["novedades.cerrar_periodo"], refresh));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar mes/ }));
    const confirm = screen.getAllByRole("button", { name: "Cerrar mes" }).at(-1)!;
    expect(await screen.findByText(/2 registro\(s\) revisados: sin problemas/)).toBeInTheDocument();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(closeCalls).toHaveLength(1);
    const [url, init] = closeCalls[0];
    expect(url).toBe("/api/novedades/overtime/months/close");
    expect(JSON.parse(String(init.body))).toEqual({ period: "2026-10", supervisorId: 6, confirm: true });
    resolve({ ok: true, status: 200, json: async () => ({ alreadyClosed: false }) } as Response);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("formatea el tiempo restante", () => {
    expect(formatRemaining(26 * 3600 + 120)).toBe("1 d 2 h");
    expect(formatRemaining(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatRemaining(59)).toBe("0 min");
  });
});

describe("OvertimeMonthBanner — revisión previa al cierre", () => {
  it("muestra los problemas encontrados sin impedir el cierre", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          records: 3,
          errors: 1,
          warnings: 1,
          issues: [
            { severity: "error", recordId: 9, label: "Ana Pérez (0102030405) 05/10/2026", message: "overtime_hours: Registre al menos una hora", fix: "Corríjalo en la captura antes de cerrar." },
            { severity: "warning", recordId: null, label: "Importación «horas.xlsx» de Sup1", message: "Quedó en vista previa sin confirmar", fix: "Confírmela o cancélela antes de cerrar." },
          ],
        }),
      })),
    );
    renderBanner(BASE);
    fireEvent.click(screen.getByRole("button", { name: /Cerrar mes/ }));
    expect(await screen.findByText(/1 con error/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Pérez \(0102030405\) 05\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Quedó en vista previa sin confirmar/)).toBeInTheDocument();
    // Solo informa: el botón de cierre sigue disponible.
    expect(screen.getAllByRole("button", { name: "Cerrar mes" }).at(-1)).toBeEnabled();
  });
});
