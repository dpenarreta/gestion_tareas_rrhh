-- CreateTable
CREATE TABLE "AnalyticsAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsAuditLog_userId_kind_period_idx" ON "AnalyticsAuditLog"("userId", "kind", "period");

-- AddForeignKey
ALTER TABLE "AnalyticsAuditLog" ADD CONSTRAINT "AnalyticsAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
