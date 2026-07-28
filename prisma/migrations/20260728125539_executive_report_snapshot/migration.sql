-- CreateEnum
CREATE TYPE "ExecutiveReportType" AS ENUM ('MENSUAL', 'RANGO_MESES', 'RANGO_PERSONALIZADO');

-- CreateEnum
CREATE TYPE "ExecutiveReportPeriodStatus" AS ENUM ('EN_CURSO', 'CERRADO', 'HISTORICO');

-- CreateEnum
CREATE TYPE "ExecutiveReportOrigin" AS ENUM ('GENERATED', 'LEGACY_MIGRATION');

-- CreateEnum
CREATE TYPE "ExecutiveReportIntegrity" AS ENUM ('FULL', 'PARTIAL');

-- CreateTable
CREATE TABLE "ExecutiveReportSnapshot" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" "ExecutiveReportType" NOT NULL,
    "scope" "ReportScope" NOT NULL,
    "origin" "ExecutiveReportOrigin" NOT NULL DEFAULT 'GENERATED',
    "integrityFlag" "ExecutiveReportIntegrity" NOT NULL DEFAULT 'FULL',
    "legacyMonthlyReportId" TEXT,
    "migratedAt" TIMESTAMP(3),
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodLabel" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "fechaCorte" TIMESTAMP(3) NOT NULL,
    "periodStatus" "ExecutiveReportPeriodStatus" NOT NULL,
    "filters" JSONB NOT NULL,
    "collaboratorIds" TEXT[],
    "collaboratorCount" INTEGER NOT NULL,
    "analyticsEngineVersion" TEXT NOT NULL,
    "formulaSetVersion" TEXT NOT NULL,
    "reportingEngineVersion" TEXT NOT NULL,
    "nexoVersion" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "nova" JSONB,
    "novaDegraded" BOOLEAN NOT NULL DEFAULT false,
    "dataQuality" JSONB NOT NULL,
    "generationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutiveReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveReportAuditLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" TEXT,
    "message" TEXT,
    "period" TEXT,
    "fechaCorte" TIMESTAMP(3),
    "filtersApplied" JSONB,
    "collaboratorCount" INTEGER,
    "generationMs" INTEGER,
    "analyticsEngineVersion" TEXT,
    "formulaSetVersion" TEXT,
    "nexoVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutiveReportAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutiveReportSnapshot_reportId_key" ON "ExecutiveReportSnapshot"("reportId");

-- CreateIndex
CREATE INDEX "ExecutiveReportSnapshot_generatedBy_createdAt_idx" ON "ExecutiveReportSnapshot"("generatedBy", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutiveReportSnapshot_type_periodStart_periodEnd_idx" ON "ExecutiveReportSnapshot"("type", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ExecutiveReportSnapshot_origin_idx" ON "ExecutiveReportSnapshot"("origin");

-- CreateIndex
CREATE INDEX "ExecutiveReportAuditLog_reportId_idx" ON "ExecutiveReportAuditLog"("reportId");

-- CreateIndex
CREATE INDEX "ExecutiveReportAuditLog_userId_createdAt_idx" ON "ExecutiveReportAuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExecutiveReportSnapshot" ADD CONSTRAINT "ExecutiveReportSnapshot_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveReportAuditLog" ADD CONSTRAINT "ExecutiveReportAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
