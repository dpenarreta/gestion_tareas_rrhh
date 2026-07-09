/*
  Warnings:

  - You are about to drop the column `fileData` on the `KnowledgeDocument` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "KnowledgeDocument" DROP COLUMN "fileData",
ADD COLUMN     "content" TEXT;
