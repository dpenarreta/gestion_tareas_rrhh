import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

type QualityItem = { id: string; label: string };
type QualityCheck = { key: string; label: string; count: number; items: QualityItem[]; note?: string };
type DjangoDataQualityReport = { generated_at: string; total_issues: number; checks: QualityCheck[] };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): Tareas, Proyectos,
// Fases, Participantes y Motivos de actividad (las 7 entidades sobre las que
// corre este informe) ya se escriben exclusivamente en Django — la versión
// anterior de este endpoint leía Postgres, cada vez más desactualizado
// respecto de los datos reales desde que esos módulos se cortaron a Django.
// `build_data_quality_report` (Fase 34) es réplica exacta de los 7 chequeos.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const response = await djangoApiFetch("/settings/data-quality/");
  if (!response) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const data = (await response.json()) as DjangoDataQualityReport;
  return NextResponse.json({
    generatedAt: data.generated_at,
    totalIssues: data.total_issues,
    checks: data.checks,
  });
}
