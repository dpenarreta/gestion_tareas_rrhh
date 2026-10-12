// Cliente del navegador para `/api/novedades/*` (proxy hacia Django). Cada
// llamada devuelve un resultado discriminado en vez de lanzar: las pantallas
// del módulo siempre muestran el mensaje de Django (que ya viene en
// español y con el motivo exacto: período cerrado, fuera de su equipo…).

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string; details?: Record<string, unknown> };

type Query = Record<string, string | number | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return `/api/novedades/${path}${qs ? `?${qs}` : ""}`;
}

async function request<T>(method: string, path: string, init: { query?: Query; body?: unknown; form?: FormData } = {}) {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, init.query), {
      method,
      headers: init.form ? undefined : { "Content-Type": "application/json" },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    return { ok: false, status: 0, error: "Sin conexión con el servidor." } as ApiResult<T>;
  }
  if (response.status === 204) return { ok: true, data: undefined as T } as ApiResult<T>;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error ?? "No se pudo completar la acción.",
      code: data?.code,
      details: data?.details,
    } as ApiResult<T>;
  }
  return { ok: true, data: data as T } as ApiResult<T>;
}

export const novedadesApi = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, { body: body ?? {} }),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
  /** Descarga un Excel generado por Django y lo entrega como archivo. */
  async download(path: string, query: Query, fallbackName: string): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(buildUrl(path, query));
    } catch {
      return "Sin conexión con el servidor.";
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return data?.error ?? "No se pudo exportar.";
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return null;
  },
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
}
