-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedMonth" TEXT,
ADD COLUMN     "color" TEXT;

-- CreateTable
CREATE TABLE "MonthClosure" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "closedBy" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalTasks" INTEGER NOT NULL,
    "completedTasks" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "MonthClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthClosure_month_year_key" ON "MonthClosure"("month", "year");

-- AddForeignKey
ALTER TABLE "MonthClosure" ADD CONSTRAINT "MonthClosure_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
