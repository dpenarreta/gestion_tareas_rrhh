-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityReason" ADD VALUE 'SEGUIMIENTO_DOCUMENTACION';
ALTER TYPE "ActivityReason" ADD VALUE 'SOLICITUDES_INTERNAS';

-- AlterTable
ALTER TABLE "MonthClosure" ADD COLUMN     "corrections" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "corrected" BOOLEAN NOT NULL DEFAULT false;
