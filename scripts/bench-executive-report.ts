// Executive Reporting Engine 2.0 (Fase IV) — benchmark de rendimiento real
// contra el presupuesto del FPS Parte IV §8 (individuales ≤5s, consolidados
// ≤15s — "individual"/"consolidado" se refiere al tamaño del roster, no al
// tipo de período; los 3 reportes de NEXO son siempre de equipo completo,
// así que se miden contra el presupuesto de 15s).
//
// Fase 77 (ver docs/AUDIT_LOG.md § 2026-08-26): reescrito para llamar al
// endpoint real (`POST /api/reports/executive`) vía HTTP contra un `next
// dev` real, en vez de invocar los builders directamente. Desde la Fase 57,
// `buildMonthlySnapshotData` depende de `djangoApiFetch`, que llama a
// `cookies()` de `next/headers` — esa función lanza fuera de un request
// real de Next.js, así que el patrón anterior ("sin HTTP, sin sesión") dejó
// de ser viable. Un login real (`POST /api/auth/login`) da cookies válidas
// que hacen que `cookies()`/`djangoApiFetch` funcionen sin tocar ningún
// código de sesión compartido — y de paso mide el camino EXACTO que sigue
// un usuario real, incluida la capa HTTP.
//
// Requiere: `next dev` corriendo en NEXT_URL (default localhost:3000) y el
// backend Django corriendo y alcanzable desde ese proceso de Next.js, ambos
// contra datos con al menos 1 usuario con permiso `canAccessReports` para
// loguearse (BENCH_EMAIL/BENCH_PASSWORD).
//
// Uso: npx tsx scripts/bench-executive-report.ts
import "dotenv/config";

const CONSOLIDADO_BUDGET_MS = 15000;
const NEXT_URL = process.env.BENCH_NEXT_URL || "http://localhost:3000";
const BENCH_EMAIL = process.env.BENCH_EMAIL || "jefe@nexo.com";
const BENCH_PASSWORD = process.env.BENCH_PASSWORD || "123456";

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function report(label: string, ms: number, collaboratorCount: number) {
  const withinBudget = ms <= CONSOLIDADO_BUDGET_MS;
  console.log(`  ${withinBudget ? "✓" : "✗"} ${label}: ${fmt(ms)} (presupuesto consolidado: ${fmt(CONSOLIDADO_BUDGET_MS)}) — ${collaboratorCount} colaboradores`);
  if (!withinBudget) console.log(`    ⚠️  EXCEDE el presupuesto de rendimiento del FPS Parte IV §8`);
}

async function login(): Promise<string> {
  const res = await fetch(`${NEXT_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login falló (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader) throw new Error("Login OK pero sin cookies en la respuesta.");
  return cookieHeader;
}

async function generate(cookieHeader: string, query: string): Promise<{ ms: number; collaboratorCount: number; generationMs: number; novaDegraded: boolean }> {
  const t0 = Date.now();
  const res = await fetch(`${NEXT_URL}/api/reports/executive?${query}`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
  });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`Generación falló (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return {
    ms,
    collaboratorCount: body.snapshot.meta.collaboratorCount,
    generationMs: body.snapshot.meta.generationMs,
    novaDegraded: body.snapshot.novaDegraded,
  };
}

async function main() {
  const now = new Date();
  console.log(`Benchmark Executive Reporting Engine — ${now.toISOString()}`);
  console.log(`Contra: ${NEXT_URL} (login: ${BENCH_EMAIL})\n`);

  const cookieHeader = await login();
  console.log("Login OK.\n");

  async function section(label: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      console.log(`  ✗ ${label}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mes calendario en curso — el camino más pesado (Índice Ejecutivo +
  // Analytics Predictivo por colaborador + las llamadas de NOVA).
  await section("MENSUAL", async () => {
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const query = `tipoReporte=MENSUAL&month=${month}`;

    const first = await generate(cookieHeader, query);
    report(`MENSUAL (mes en curso, ${month})`, first.ms, first.collaboratorCount);
    console.log(`    generationMs interno del snapshot: ${fmt(first.generationMs)} · novaDegraded: ${first.novaDegraded}`);

    // Segunda generación — demuestra el efecto real de cached() en una
    // regeneración dentro de la ventana de caché, como ocurriría con una
    // segunda solicitud real sin reiniciar el servidor.
    const second = await generate(cookieHeader, query);
    report(`MENSUAL — 2ª generación (efecto de cached())`, second.ms, second.collaboratorCount);
    console.log(`    generationMs interno del snapshot: ${fmt(second.generationMs)} · novaDegraded: ${second.novaDegraded}`);
  });

  // Rango de 3 meses calendario.
  await section("RANGO_MESES", async () => {
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const fromDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}`;
    const result = await generate(cookieHeader, `tipoReporte=RANGO_MESES&from=${from}&to=${to}`);
    report(`RANGO_MESES (${from} a ${to})`, result.ms, result.collaboratorCount);
    console.log(`    generationMs interno del snapshot: ${fmt(result.generationMs)} · novaDegraded: ${result.novaDegraded}`);
  });

  // Rango personalizado de 30 días.
  await section("RANGO_PERSONALIZADO", async () => {
    const to = now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime() - 29 * 86400000);
    const from = fromDate.toISOString().slice(0, 10);
    const result = await generate(cookieHeader, `tipoReporte=RANGO_PERSONALIZADO&from=${from}&to=${to}`);
    report(`RANGO_PERSONALIZADO (${from} a ${to})`, result.ms, result.collaboratorCount);
    console.log(`    generationMs interno del snapshot: ${fmt(result.generationMs)} · novaDegraded: ${result.novaDegraded}`);
  });
}

main().catch((err) => {
  console.error("Error fatal en el benchmark:", err);
  process.exitCode = 1;
});
