-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityReason" ADD VALUE 'VISITA_DOMICILIARIA';
ALTER TYPE "ActivityReason" ADD VALUE 'SEGUIMIENTO_AUSENTISMOS';
ALTER TYPE "ActivityReason" ADD VALUE 'RECLUTAMIENTO_SELECCION';

-- AlterTable
ALTER TABLE "TaskActivity" ADD COLUMN     "description" TEXT;
