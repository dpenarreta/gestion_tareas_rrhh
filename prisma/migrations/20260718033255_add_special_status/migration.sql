-- CreateEnum
CREATE TYPE "SpecialStatusType" AS ENUM ('MATERNIDAD', 'LACTANCIA');

-- CreateTable
CREATE TABLE "SpecialStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SpecialStatusType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialStatus_userId_startDate_idx" ON "SpecialStatus"("userId", "startDate");

-- AddForeignKey
ALTER TABLE "SpecialStatus" ADD CONSTRAINT "SpecialStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialStatus" ADD CONSTRAINT "SpecialStatus_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
