// Executive Reporting Engine 2.0 (Fase D) — backfill de UNA sola corrida:
// migra cada MonthlyReport histórico a un ExecutiveReportSnapshot con Report
// ID propio (prefijo NXR-LEGACY-*), `origin: LEGACY_MIGRATION`,
// `integrityFlag: PARTIAL` (siempre — ningún MonthlyReport histórico registró
// calidad de dato, versiones de motor/fórmulas, ni narrativa NOVA
// estructurada, así que nunca puede reconstruirse 1:1 el esquema nuevo).
//
// MonthlyReport NUNCA se modifica ni se borra — este script solo LEE de ahí
// e INSERTA en ExecutiveReportSnapshot. Es aditivo y, si algo sale mal a
// mitad de camino, se puede volver a correr (las filas ya migradas se
// detectan por `legacyMonthlyReportId` y se saltan).
//
// Uso:
//   npx tsx scripts/backfill-executive-report-snapshots.ts            (dry-run, no escribe nada)
//   npx tsx scripts/backfill-executive-report-snapshots.ts --dry-run  (idéntico, explícito)
//   npx tsx scripts/backfill-executive-report-snapshots.ts --execute  (corrida real — pide confirmación)
import "dotenv/config";
import * as readline from "node:readline/promises";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateLegacyReportId } from "../src/lib/executiveReporting/reportId";
import type { ReportMemberKpi, MotivoDistributionItem, IndiceEjecutivoData } from "../src/components/kpis/types";
import type { Finding, Recommendation, IndicatorExplanation, RiskQuadrant, TrendComparison } from "../src/lib/reportInsights";
import type { ExecutiveReportSnapshotData } from "../src/lib/executiveReporting/snapshotData";

/**
 * Forma congelada del `MonthlyReport.data` histórico (pre Executive
 * Reporting Engine 2.0) — YA NO existe un tipo `ReportData` vivo en la app
 * (el único endpoint que lo producía, /api/reports/generate, fue retirado al
 * repuntar MonthlyReports.tsx al motor unificado). Se declara aquí, local al
 * script, porque describe un esquema histórico archivado — no debe cambiar
 * nunca, independientemente de cómo evolucione el tipo vivo del motor nuevo.
 */
type LegacyReportData = {
  teamSummary: ExecutiveReportSnapshotData["teamSummary"];
  members?: ReportMemberKpi[];
  ranking?: Array<{ id: string; name: string; role: string; score: number; completedPct: number }>;
  consultasByReason?: MotivoDistributionItem[];
  alerts?: Array<{ userId: string; name: string; type: "cumplimiento" | "sobrecarga"; value: number }>;
  indiceEjecutivo?: IndiceEjecutivoData;
  trends?: { mesAnterior: TrendComparison; trimestre: TrendComparison; semestre: TrendComparison };
  riskQuadrant?: Array<{ id: string; name: string; completedPct: number; cargaPct: number; quadrant: RiskQuadrant }>;
  findings?: Finding[];
  recommendations?: Array<{ text: string; priority: "alta" | "media" }>;
  insights?: string[];
  indicatorExplanations?: { cumplimiento: IndicatorExplanation; carga: IndicatorExplanation; consultas: IndicatorExplanation };
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const execute = args.includes("--execute");

const PLACEHOLDER_EXPLANATION: IndicatorExplanation = {
  meaning: "No disponible — este reporte fue migrado desde el histórico previo al Executive Reporting Engine 2.0.",
  why: "",
  impact: "",
  action: "",
};

function buildLegacyMemberIndicatorExplanations(old: LegacyReportData): { cumplimiento: IndicatorExplanation; carga: IndicatorExplanation; consultas: IndicatorExplanation } {
  return old.indicatorExplanations ?? { cumplimiento: PLACEHOLDER_EXPLANATION, carga: PLACEHOLDER_EXPLANATION, consultas: PLACEHOLDER_EXPLANATION };
}

/** Recomendaciones históricas nunca tuvieron `id` (se agregó recién en Fase B) — se sintetiza uno estable por posición, prefijado para que nunca choque con un id real generado por reglas (ver reportInsights.ts). */
function withLegacyIds(recs: Array<{ text: string; priority: "alta" | "media" }> | undefined): Recommendation[] {
  return (recs ?? []).map((r, i) => ({ id: `legacy-${i}`, text: r.text, priority: r.priority }));
}

function adaptLegacyReportData(old: LegacyReportData): Omit<ExecutiveReportSnapshotData, "meta"> {
  const members: ReportMemberKpi[] = old.members ?? [];
  const consultasByReason: MotivoDistributionItem[] = old.consultasByReason ?? [];
  const riskQuadrant: Array<{ id: string; name: string; completedPct: number; cargaPct: number; quadrant: RiskQuadrant }> = old.riskQuadrant ?? [];
  const findings: Finding[] = old.findings ?? [];

  return {
    estadoGeneral: {
      indiceEjecutivo: old.indiceEjecutivo ?? null,
      // 100/sin-issues es el mismo valor centinela que analytics.computeDataQuality
      // usa para "no aplica" (ver computeDataQuality con userIds=[]) — nunca se
      // calculó realmente para estos reportes, integrityFlag=PARTIAL lo documenta.
      dataQuality: { pct: 100, issues: [] },
    },
    teamSummary: old.teamSummary,
    members,
    ranking: old.ranking ?? [],
    distribuciones: { consultasByReason, riskQuadrant },
    trends: old.trends ?? null,
    monthlyEvolution: null,
    rangeTrend: null,
    problematicMonths: null,
    findings,
    insights: old.insights ?? [],
    indicatorExplanations: buildLegacyMemberIndicatorExplanations(old),
    recommendations: withLegacyIds(old.recommendations),
    alerts: (old.alerts ?? []).map((a) => ({ userId: a.userId, name: a.name, type: a.type, value: a.value })),
    predictivo: null,
    nova: null,
    novaDegraded: true,
  };
}

async function main() {
  console.log(execute ? "MODO: ejecución real (--execute)" : "MODO: dry-run (por defecto — no se escribe nada)");

  const monthlyReports = await prisma.monthlyReport.findMany({
    include: { generator: { select: { id: true, name: true } } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  console.log(`MonthlyReport encontrados: ${monthlyReports.length}`);

  const alreadyMigrated = await prisma.executiveReportSnapshot.findMany({
    where: { origin: "LEGACY_MIGRATION" },
    select: { legacyMonthlyReportId: true },
  });
  const migratedIds = new Set(alreadyMigrated.map((r) => r.legacyMonthlyReportId).filter((id): id is string => id !== null));

  const pending = monthlyReports.filter((r) => !migratedIds.has(r.id));
  console.log(`Ya migrados (se omiten): ${monthlyReports.length - pending.length}`);
  console.log(`Pendientes de migrar: ${pending.length}`);

  if (pending.length === 0) {
    console.log("Nada que migrar.");
    return;
  }

  console.log("\nMuestra (primeros 3 pendientes):");
  for (const r of pending.slice(0, 3)) {
    console.log(`  - month_year_scope=${r.month}-${r.year}-${r.scope} · generador=${r.generator.name} · createdAt=${r.createdAt.toISOString()}`);
  }

  if (!execute) {
    console.log("\nDry-run completo. Ninguna fila fue escrita. Corre con --execute para migrar de verdad.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\n⚠️  Vas a INSERTAR ${pending.length} filas nuevas en ExecutiveReportSnapshot (base compartida). MonthlyReport NO se modifica. Escribe "si" para confirmar: `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario.");
    return;
  }

  let migrated = 0;
  let failed = 0;

  for (const report of pending) {
    const old = report.data as unknown as LegacyReportData;
    const periodStart = new Date(report.year, report.month - 1, 1);
    const periodEnd = new Date(report.year, report.month, 0, 23, 59, 59, 999);
    const periodLabel = periodStart.toLocaleDateString("es-CL", { month: "long", year: "numeric" });

    const adapted = adaptLegacyReportData(old);

    // MonthlyReport.aiAnalysis vive en su propia columna, no en `data` — se
    // anexa aparte (campo no tipado, exclusivo de filas LEGACY_MIGRATION)
    // para no perder el texto libre que Groq generó en su momento.
    const dataWithLegacyText = {
      ...adapted,
      legacyAiAnalysisText: (report as unknown as { aiAnalysis: string | null }).aiAnalysis ?? undefined,
    };

    let attempt = 0;
    let inserted = false;
    while (attempt < 5 && !inserted) {
      attempt++;
      const reportId = generateLegacyReportId(report.createdAt);
      try {
        await prisma.executiveReportSnapshot.create({
          data: {
            reportId,
            type: "MENSUAL",
            scope: report.scope,
            origin: "LEGACY_MIGRATION",
            integrityFlag: "PARTIAL",
            legacyMonthlyReportId: report.id,
            migratedAt: new Date(),
            generatedBy: report.generatedBy,
            generatedAt: report.createdAt,
            periodLabel,
            periodStart,
            periodEnd,
            fechaCorte: report.updatedAt,
            periodStatus: "HISTORICO",
            filters: { periodo: { tipoReporte: "MENSUAL", month: report.month, year: report.year } },
            collaboratorIds: adapted.members.map((m) => m.id),
            collaboratorCount: adapted.members.length,
            analyticsEngineVersion: "desconocida (pre Executive Reporting Engine 2.0)",
            formulaSetVersion: "desconocida (pre Executive Reporting Engine 2.0)",
            reportingEngineVersion: "legacy",
            nexoVersion: "desconocida (pre Executive Reporting Engine 2.0)",
            data: dataWithLegacyText,
            nova: Prisma.JsonNull,
            novaDegraded: true,
            dataQuality: adapted.estadoGeneral.dataQuality,
            generationMs: 0,
          },
        });
        inserted = true;
      } catch (err) {
        const isCollision =
          typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
        if (!isCollision || attempt >= 5) {
          console.error(`  ✗ Error migrando MonthlyReport ${report.id} (${report.month}-${report.year}-${report.scope}):`, err);
          failed++;
          break;
        }
        // colisión de reportId — reintenta con uno nuevo
      }
    }
    if (inserted) migrated++;
  }

  console.log(`\nMigración completa. Migrados: ${migrated}. Fallidos: ${failed}. Total pendientes procesados: ${pending.length}.`);
}

main()
  .catch((err) => {
    console.error("Error fatal en el backfill:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
