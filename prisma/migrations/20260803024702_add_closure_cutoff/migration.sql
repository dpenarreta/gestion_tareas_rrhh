-- Motor de Cierre Inteligente con Fecha de Corte — columnas se agregan
-- NULLABLE a propósito: filas históricas de MonthClosure no tienen forma de
-- derivar workingDaysConsidered/workingHoursConsidered en SQL puro (dependen
-- de feriados configurados y horas efectivas vigentes al momento, lógica que
-- solo vive en src/lib/workload.ts). El script
-- scripts/backfill-month-closure-cutoff.ts rellena estas columnas para todo
-- MonthClosure preexistente usando esa misma lógica; una migración de
-- seguimiento (add_closure_cutoff_not_null) endurece las columnas a NOT NULL
-- una vez confirmado que el backfill corrió.
-- CreateEnum
CREATE TYPE "MonthClosureType" AS ENUM ('NORMAL', 'EARLY', 'MANUAL');

-- AlterTable
ALTER TABLE "MonthClosure" ADD COLUMN     "calendarDaysConsidered" INTEGER,
ADD COLUMN     "calendarDaysTotal" INTEGER,
ADD COLUMN     "closureType" "MonthClosureType" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "cutoffDate" TIMESTAMP(3),
ADD COLUMN     "workingDaysConsidered" INTEGER,
ADD COLUMN     "workingHoursConsidered" DOUBLE PRECISION;
