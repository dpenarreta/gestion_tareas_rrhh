-- CreateEnum
CREATE TYPE "DeskNotePriority" AS ENUM ('INFORMACION', 'RECORDATORIO', 'IMPORTANTE', 'URGENTE');

-- CreateTable
CREATE TABLE "DeskNote" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" "DeskNotePriority" NOT NULL DEFAULT 'INFORMACION',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeskNote_recipientId_archived_deletedAt_createdAt_idx" ON "DeskNote"("recipientId", "archived", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DeskNote_senderId_deletedAt_createdAt_idx" ON "DeskNote"("senderId", "deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "DeskNote" ADD CONSTRAINT "DeskNote_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskNote" ADD CONSTRAINT "DeskNote_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
