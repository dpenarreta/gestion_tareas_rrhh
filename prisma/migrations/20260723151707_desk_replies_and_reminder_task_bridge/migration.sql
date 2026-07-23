/*
  Warnings:

  - You are about to drop the column `convertedToTaskId` on the `DeskNote` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeskAuditAction" ADD VALUE 'CONVERTED_TO_REMINDER';
ALTER TYPE "DeskAuditAction" ADD VALUE 'REPLIED';

-- DropForeignKey
ALTER TABLE "DeskNote" DROP CONSTRAINT "DeskNote_convertedToTaskId_fkey";

-- AlterTable
ALTER TABLE "DeskNote" DROP COLUMN "convertedToTaskId",
ADD COLUMN     "convertedToReminderId" TEXT;

-- AlterTable
ALTER TABLE "PersonalReminder" ADD COLUMN     "attachmentData" TEXT,
ADD COLUMN     "attachmentMime" TEXT,
ADD COLUMN     "attachmentName" TEXT,
ADD COLUMN     "convertedToTaskAt" TIMESTAMP(3),
ADD COLUMN     "convertedToTaskId" TEXT;

-- CreateTable
CREATE TABLE "DeskNoteReply" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskNoteReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeskNoteReply_noteId_createdAt_idx" ON "DeskNoteReply"("noteId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeskNote" ADD CONSTRAINT "DeskNote_convertedToReminderId_fkey" FOREIGN KEY ("convertedToReminderId") REFERENCES "PersonalReminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskNoteReply" ADD CONSTRAINT "DeskNoteReply_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "DeskNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskNoteReply" ADD CONSTRAINT "DeskNoteReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalReminder" ADD CONSTRAINT "PersonalReminder_convertedToTaskId_fkey" FOREIGN KEY ("convertedToTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
