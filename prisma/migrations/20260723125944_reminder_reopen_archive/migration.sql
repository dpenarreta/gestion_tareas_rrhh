-- AlterEnum
ALTER TYPE "DeskAuditAction" ADD VALUE 'REOPENED';

-- AlterTable
ALTER TABLE "PersonalReminder" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PersonalReminder_userId_archived_idx" ON "PersonalReminder"("userId", "archived");
