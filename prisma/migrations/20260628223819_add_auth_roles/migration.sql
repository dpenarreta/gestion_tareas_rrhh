/*
  Warnings:

  - Added the required column `password` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `role` to the `User` table without a default value. This is not possible if the table is not empty.
  - Made the column `name` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('JEFE_NACIONAL', 'COORDINADOR_NACIONAL', 'COORDINADOR_ZS', 'ANALISTA_CC', 'ANALISTA_SELECCION', 'ASISTENTE_SELECCION', 'ASISTENTE_GH', 'ASISTENTE_GH_ZS', 'TRABAJO_SOCIAL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "password" TEXT NOT NULL,
ADD COLUMN     "role" "Role" NOT NULL,
ALTER COLUMN "name" SET NOT NULL;
