-- CreateEnum
CREATE TYPE "DeskNoteColor" AS ENUM ('AMARILLO', 'ROSADO', 'CELESTE', 'VERDE', 'NARANJA', 'LILA');

-- CreateEnum
CREATE TYPE "ReminderPriority" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDIENTE', 'COMPLETADO');

-- CreateEnum
CREATE TYPE "ReminderRepeat" AS ENUM ('UNA_VEZ', 'DIARIO', 'SEMANAL', 'MENSUAL');

-- CreateEnum
CREATE TYPE "DeskAuditAction" AS ENUM ('CREATED', 'EDITED', 'READ', 'PINNED', 'UNPINNED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'CONVERTED_TO_TASK', 'PRIORITY_CHANGED', 'POSTPONED', 'COMPLETED');

-- AlterTable
ALTER TABLE "DeskNote" ADD COLUMN     "attachmentData" TEXT,
ADD COLUMN     "attachmentMime" TEXT,
ADD COLUMN     "attachmentName" TEXT,
ADD COLUMN     "color" "DeskNoteColor" NOT NULL DEFAULT 'AMARILLO',
ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "convertedToTaskId" TEXT;

-- CreateTable
CREATE TABLE "PersonalReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" "ReminderPriority" NOT NULL DEFAULT 'MEDIA',
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDIENTE',
    "repeat" "ReminderRepeat" NOT NULL DEFAULT 'UNA_VEZ',
    "completedAt" TIMESTAMP(3),
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskAuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "DeskAuditAction" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalReminder_userId_status_dueAt_idx" ON "PersonalReminder"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "DeskAuditLog_entityType_entityId_idx" ON "DeskAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "DeskAuditLog_userId_createdAt_idx" ON "DeskAuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeskNote" ADD CONSTRAINT "DeskNote_convertedToTaskId_fkey" FOREIGN KEY ("convertedToTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalReminder" ADD CONSTRAINT "PersonalReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskAuditLog" ADD CONSTRAINT "DeskAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
