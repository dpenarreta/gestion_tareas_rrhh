-- CreateEnum
CREATE TYPE "TargetTimeAdjustReason" AS ENUM ('PROCEDIMIENTO_ESTANDAR', 'COMPLEJIDAD_DETECTADA', 'CAMBIO_ALCANCE', 'REVISION_LIDER', 'OTRO');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "targetTimeValidated" DOUBLE PRECISION,
ADD COLUMN     "targetTimeValidatedAt" TIMESTAMP(3),
ADD COLUMN     "targetTimeValidatedById" TEXT;

-- CreateTable
CREATE TABLE "TargetTimeAuditLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" "Role" NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "newValue" DOUBLE PRECISION NOT NULL,
    "reason" "TargetTimeAdjustReason" NOT NULL,
    "reasonDetail" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetTimeAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetTimeAuditLog_taskId_idx" ON "TargetTimeAuditLog"("taskId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_targetTimeValidatedById_fkey" FOREIGN KEY ("targetTimeValidatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetTimeAuditLog" ADD CONSTRAINT "TargetTimeAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
