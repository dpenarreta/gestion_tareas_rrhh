-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('ACTIVE', 'RESTORED', 'PURGED');

-- CreateEnum
CREATE TYPE "RecoveryOperation" AS ENUM ('MOVE_TO_TRASH', 'RESTORE', 'DELETE_PERMANENTLY', 'PURGE_EXPIRED');

-- CreateEnum
CREATE TYPE "RecoveryOrigin" AS ENUM ('MANUAL', 'AUTOMATIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectHistoryEvent" ADD VALUE 'ELIMINADO';
ALTER TYPE "ProjectHistoryEvent" ADD VALUE 'RESTAURADO';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RecoveryItem" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "moduleLabel" TEXT NOT NULL,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionHours" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "restoredById" TEXT,
    "restoredAt" TIMESTAMP(3),
    "purgedById" TEXT,
    "purgedAt" TIMESTAMP(3),
    "purgeOrigin" "RecoveryOrigin",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryAuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "moduleLabel" TEXT NOT NULL,
    "userId" TEXT,
    "operation" "RecoveryOperation" NOT NULL,
    "origin" "RecoveryOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryItem_entityType_entityId_idx" ON "RecoveryItem"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "RecoveryItem_status_expiresAt_idx" ON "RecoveryItem"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RecoveryAuditLog_entityType_entityId_idx" ON "RecoveryAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "RecoveryAuditLog_createdAt_idx" ON "RecoveryAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- AddForeignKey
ALTER TABLE "RecoveryItem" ADD CONSTRAINT "RecoveryItem_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryItem" ADD CONSTRAINT "RecoveryItem_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryItem" ADD CONSTRAINT "RecoveryItem_purgedById_fkey" FOREIGN KEY ("purgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryAuditLog" ADD CONSTRAINT "RecoveryAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
