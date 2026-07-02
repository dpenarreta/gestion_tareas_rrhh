-- CreateEnum
CREATE TYPE "IdeaArea" AS ENUM ('SELECCION', 'GESTION_HUMANA', 'CLIMA_CULTURA', 'NOMINA', 'OPERACIONES', 'OTRO');

-- CreateEnum
CREATE TYPE "IdeaImpact" AS ENUM ('ALTO', 'MEDIO', 'BAJO');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('PROPUESTA', 'EN_REVISION', 'APROBADA', 'EN_DESARROLLO', 'EN_PRUEBAS', 'IMPLEMENTADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "ImprovementIdea" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "area" "IdeaArea" NOT NULL,
    "impact" "IdeaImpact" NOT NULL,
    "status" "IdeaStatus" NOT NULL DEFAULT 'PROPUESTA',
    "authorId" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaStatusHistory" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "fromStatus" "IdeaStatus" NOT NULL,
    "toStatus" "IdeaStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaStatusHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ImprovementIdea" ADD CONSTRAINT "ImprovementIdea_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaStatusHistory" ADD CONSTRAINT "IdeaStatusHistory_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ImprovementIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaStatusHistory" ADD CONSTRAINT "IdeaStatusHistory_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
