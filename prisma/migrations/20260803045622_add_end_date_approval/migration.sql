-- CreateEnum
CREATE TYPE "EndDateApprovalStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'MODIFICADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "EndDateAuditAction" AS ENUM ('PROPUESTA', 'APROBADA', 'MODIFICADA', 'RECHAZADA');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "endDateApprovalStatus" "EndDateApprovalStatus" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "endDateApprovedAt" TIMESTAMP(3),
ADD COLUMN     "endDateApprovedById" TEXT;

-- CreateTable
CREATE TABLE "EndDateAuditLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" "Role" NOT NULL,
    "action" "EndDateAuditAction" NOT NULL,
    "previousValue" TIMESTAMP(3),
    "newValue" TIMESTAMP(3),
    "observaciones" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndDateAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndDateAuditLog_taskId_idx" ON "EndDateAuditLog"("taskId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_endDateApprovedById_fkey" FOREIGN KEY ("endDateApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndDateAuditLog" ADD CONSTRAINT "EndDateAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
