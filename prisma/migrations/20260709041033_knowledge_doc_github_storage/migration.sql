/*
  Warnings:

  - You are about to drop the column `driveFileId` on the `KnowledgeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `driveUrl` on the `KnowledgeDocument` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "KnowledgeDocument" DROP COLUMN "driveFileId",
DROP COLUMN "driveUrl",
ADD COLUMN     "githubPath" TEXT,
ADD COLUMN     "githubSha" TEXT;
