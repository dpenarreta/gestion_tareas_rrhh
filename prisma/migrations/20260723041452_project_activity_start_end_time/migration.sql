/*
  Warnings:

  - You are about to drop the column `time` on the `ProjectActivity` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProjectActivity" DROP COLUMN "time",
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "startTime" TEXT;
