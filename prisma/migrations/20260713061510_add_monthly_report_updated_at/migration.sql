-- AlterTable
ALTER TABLE "MonthlyReport" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill: for existing rows, use createdAt as the initial updatedAt value
UPDATE "MonthlyReport" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Now enforce NOT NULL for future rows
ALTER TABLE "MonthlyReport" ALTER COLUMN "updatedAt" SET NOT NULL;
