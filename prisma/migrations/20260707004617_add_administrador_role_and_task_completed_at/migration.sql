-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMINISTRADOR';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3);
