// Motor de Cierre Inteligente con Fecha de Corte — backfill de UNA sola
// corrida para las filas de MonthClosure creadas ANTES de este sprint, que no
// tienen cutoffDate/calendarDays*/workingDays*Considered (la migración
// add_closure_cutoff las agregó NULLABLE justamente para permitir este
// backfill). Todo MonthClosure histórico se trató siempre como el mes
// calendario completo, así que el backfill es directo: cutoffDate = último
// día calendario del mes, closureType = NORMAL, y días/horas hábiles
// recalculados con la misma lógica de negocio vigente (workload.ts) — cero
// distorsión respecto al comportamiento que esas filas ya tenían.
//
// Uso:
//   npx tsx scripts/backfill-month-closure-cutoff.ts            (dry-run, no escribe nada)
//   npx tsx scripts/backfill-month-closure-cutoff.ts --dry-run  (idéntico, explícito)
//   npx tsx scripts/backfill-month-closure-cutoff.ts --execute  (corrida real — pide confirmación)
// `src/lib/workload.ts` (y todo lo que consulta feriados/horas efectivas) usa
// `import "server-only"` y no puede importarse desde un script plano (throws
// incondicional fuera de un Server Component) — este script replica
// directamente, con las mismas tablas/claves, la parte de esa lógica que
// necesita (isWorkingDay + horas efectivas vigentes al inicio del mes), igual
// que hace `businessBaseCore`. Si esa fórmula cambia alguna vez, este
// backfill de un solo uso no necesita seguir sincronizado — ya habrá corrido.
import "dotenv/config";
import * as readline from "node:readline/promises";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const execute = args.includes("--execute");

const CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA";
const DEFAULT_HORAS_EFECTIVAS = 6.5;

function monthPeriod(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1) - 1);
  return { start, end };
}

function isWorkingDay(d: Date, holidays: Set<number>): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(d.getTime());
}

function countBusinessDays(start: Date, end: Date, holidays: Set<number>): number {
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    if (isWorkingDay(new Date(t), holidays)) count++;
  }
  return count;
}

async function getHolidaySet(): Promise<Set<number>> {
  const holidays = await prisma.holiday.findMany({ select: { date: true } });
  return new Set(holidays.map((h) => h.date.getTime()));
}

async function getEffectiveHorasEfectivas(asOf: Date): Promise<number> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: {
      key: CONFIG_KEY_HORAS_EFECTIVAS,
      validFrom: { lte: asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (!record) return DEFAULT_HORAS_EFECTIVAS;
  const parsed = parseFloat(record.value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_HORAS_EFECTIVAS;
}

async function main() {
  // `cutoffDate` es NOT NULL en el schema actual (la migración de
  // seguimiento add_closure_cutoff_not_null ya se aplicó) — un `findMany`
  // tipado con Prisma Client no puede siquiera expresar "cutoffDate es
  // null" contra ese tipo. Se usa SQL crudo a propósito, para que este
  // script siga siendo válido si algún día se corre contra una base que
  // todavía está en el estado intermedio (columnas nullable, backfill
  // pendiente, NOT NULL sin aplicar todavía).
  const pending = await prisma.$queryRaw<Array<{ id: string; year: number; month: number }>>`
    SELECT id, year, month FROM "MonthClosure" WHERE "cutoffDate" IS NULL ORDER BY year ASC, month ASC
  `;

  if (pending.length === 0) {
    console.log("Nada que hacer — no hay MonthClosure sin cutoffDate.");
    return;
  }

  console.log(`${pending.length} MonthClosure a rellenar:\n`);

  const holidays = await getHolidaySet();

  const updates = await Promise.all(
    pending.map(async (closure) => {
      const { start, end } = monthPeriod(closure.year, closure.month);
      const hoursPerDay = await getEffectiveHorasEfectivas(start);
      const businessDays = countBusinessDays(start, end, holidays);
      const calendarDaysTotal = end.getUTCDate();
      return {
        id: closure.id,
        year: closure.year,
        month: closure.month,
        cutoffDate: end,
        calendarDaysTotal,
        calendarDaysConsidered: calendarDaysTotal,
        workingDaysConsidered: businessDays,
        workingHoursConsidered: businessDays * hoursPerDay,
      };
    })
  );

  for (const u of updates) {
    console.log(
      `  ${u.year}-${String(u.month).padStart(2, "0")}: cutoffDate=${u.cutoffDate.toISOString().slice(0, 10)} ` +
      `calendarDays=${u.calendarDaysTotal} workingDays=${u.workingDaysConsidered} workingHours=${u.workingHoursConsidered}`
    );
  }

  if (!execute) {
    console.log("\nDry-run — nada escrito. Vuelve a correr con --execute para aplicar.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nSe van a actualizar ${updates.length} filas de MonthClosure. Escribe "si" para confirmar: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }

  for (const u of updates) {
    await prisma.monthClosure.update({
      where: { id: u.id },
      data: {
        cutoffDate: u.cutoffDate,
        calendarDaysTotal: u.calendarDaysTotal,
        calendarDaysConsidered: u.calendarDaysConsidered,
        workingDaysConsidered: u.workingDaysConsidered,
        workingHoursConsidered: u.workingHoursConsidered,
      },
    });
  }
  console.log(`\n${updates.length} filas actualizadas.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
