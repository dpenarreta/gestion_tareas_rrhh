// Executive Reporting Engine 2.0 (Fase IV) — benchmark de rendimiento real
// contra el presupuesto del FPS Parte IV §8 (individuales ≤5s, consolidados
// ≤15s — "individual"/"consolidado" se refiere al tamaño del roster, no al
// tipo de período; los 3 reportes de NEXO son siempre de equipo completo,
// así que se miden contra el presupuesto de 15s). Llama a los builders
// DIRECTAMENTE (mismo patrón que el backfill: sin HTTP, sin sesión) contra
// datos reales — no un mock. Solo lee, nunca escribe.
//
// Uso: npx tsx scripts/bench-executive-report.ts
import "dotenv/config";

const CONSOLIDADO_BUDGET_MS = 15000;

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function report(label: string, ms: number, collaboratorCount: number) {
  const withinBudget = ms <= CONSOLIDADO_BUDGET_MS;
  console.log(`  ${withinBudget ? "✓" : "✗"} ${label}: ${fmt(ms)} (presupuesto consolidado: ${fmt(CONSOLIDADO_BUDGET_MS)}) — ${collaboratorCount} colaboradores`);
  if (!withinBudget) console.log(`    ⚠️  EXCEDE el presupuesto de rendimiento del FPS Parte IV §8`);
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { resolveReportRoster } = await import("../src/lib/executiveReporting/resolveRoster");
  const { buildMonthlySnapshotData, buildRangeSnapshotData, buildCustomRangeSnapshotData } = await import("../src/lib/executiveReporting/buildSnapshotData");

  const now = new Date();
  const generatedBy = { userId: "bench-script", name: "Benchmark" };
  const session = { role: "JEFE_NACIONAL" as const };

  console.log(`Benchmark Executive Reporting Engine — ${now.toISOString()}`);
  console.log(`GROQ_API_KEY ${process.env.GROQ_API_KEY ? "configurada (mide latencia real de NOVA)" : "NO configurada (NOVA degrada de inmediato — timing optimista, sin latencia de red)"}\n`);

  const roster = await resolveReportRoster(session, {});
  console.log(`Roster resuelto: ${roster.userIds.length} colaboradores.\n`);

  // Mes calendario en curso — el camino más pesado (Índice Ejecutivo +
  // Analytics Predictivo por colaborador + las 4 llamadas de NOVA).
  {
    const t0 = Date.now();
    const snapshot = await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: now.getMonth() + 1, year: now.getFullYear() } },
      generatedBy,
      now,
    });
    report(`MENSUAL (mes en curso, ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")})`, Date.now() - t0, roster.userIds.length);
    console.log(`    generationMs interno del snapshot: ${fmt(snapshot.meta.generationMs)} · novaDegraded: ${snapshot.novaDegraded}`);

    // Segunda generación, MISMO proceso — demuestra el efecto real de cached()
    // (caché en memoria por proceso, TTL configurable) en una regeneración
    // dentro de la ventana de caché, como ocurriría en un servidor real de
    // Next.js atendiendo una segunda solicitud sin reiniciar.
    const t1 = Date.now();
    await buildMonthlySnapshotData({
      roster,
      filters: { periodo: { tipoReporte: "MENSUAL", month: now.getMonth() + 1, year: now.getFullYear() } },
      generatedBy,
      now,
    });
    report(`MENSUAL — 2ª generación, mismo proceso (efecto de cached())`, Date.now() - t1, roster.userIds.length);
  }

  // Rango de 3 meses calendario.
  {
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const fromDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}`;
    const t0 = Date.now();
    const snapshot = await buildRangeSnapshotData({ roster, filters: { periodo: { tipoReporte: "RANGO_MESES", from, to } }, generatedBy, now });
    report(`RANGO_MESES (${from} a ${to})`, Date.now() - t0, roster.userIds.length);
    console.log(`    generationMs interno del snapshot: ${fmt(snapshot.meta.generationMs)} · novaDegraded: ${snapshot.novaDegraded}`);
  }

  // Rango personalizado de 30 días.
  {
    const to = now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime() - 29 * 86400000);
    const from = fromDate.toISOString().slice(0, 10);
    const t0 = Date.now();
    const snapshot = await buildCustomRangeSnapshotData({ roster, filters: { periodo: { tipoReporte: "RANGO_PERSONALIZADO", from, to } }, generatedBy, now });
    report(`RANGO_PERSONALIZADO (${from} a ${to})`, Date.now() - t0, roster.userIds.length);
    console.log(`    generationMs interno del snapshot: ${fmt(snapshot.meta.generationMs)} · novaDegraded: ${snapshot.novaDegraded}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error fatal en el benchmark:", err);
  process.exitCode = 1;
});
