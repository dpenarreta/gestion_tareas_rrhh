-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PROCESANDO', 'LISTO', 'ERROR');

-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveUrl" TEXT,
ADD COLUMN     "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'LISTO';

-- CreateTable
CREATE TABLE "SystemConfigHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemConfigHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemConfigHistory_key_validFrom_idx" ON "SystemConfigHistory"("key", "validFrom");

-- AddForeignKey
ALTER TABLE "SystemConfigHistory" ADD CONSTRAINT "SystemConfigHistory_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
