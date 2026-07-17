-- AlterEnum
ALTER TYPE "LeaveType" ADD VALUE 'VACACIONES';

-- AlterTable
ALTER TABLE "ActivityReason" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kpiStartDate" TIMESTAMP(3);
