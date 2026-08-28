import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 59): esta ruta
// pasó de Prisma (`getEffectiveNovaCacheTtlMinutes`/`setNovaCacheTtlMinutes`,
// `src/lib/systemConfig.ts`) a Django (`NovaCacheView`, completa desde la
// Fase 34) — cierra la staleness que quedaba desde entonces: editar el TTL
// desde Ajustes no tenía ningún efecto en el TTL real que usaban
// `dashboard/nova-message`/`kpis/nova-insights` (Fase 59, mismo cambio,
// ver `src/lib/djangoNovaCacheConfig.ts`).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/nova-cache/");
  if (!response || !response.ok) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  const data = (await response.json()) as { cache_ttl_minutes: number };
  return NextResponse.json({ cacheTtlMinutes: data.cache_ttl_minutes });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { cacheTtlMinutes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { cacheTtlMinutes } = body;
  if (cacheTtlMinutes === undefined || !Number.isInteger(cacheTtlMinutes) || cacheTtlMinutes < 1 || cacheTtlMinutes > 10080) {
    return NextResponse.json({ error: "El TTL de caché debe ser un entero entre 1 y 10080 minutos (7 días)" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/nova-cache/", {
    method: "PUT",
    body: JSON.stringify({ cache_ttl_minutes: cacheTtlMinutes }),
  });
  if (!response) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "El TTL de caché debe ser un entero entre 1 y 10080 minutos (7 días)" }, { status: 400 });
  }

  const data = (await response.json()) as { cache_ttl_minutes: number };
  return NextResponse.json({ cacheTtlMinutes: data.cache_ttl_minutes });
}
