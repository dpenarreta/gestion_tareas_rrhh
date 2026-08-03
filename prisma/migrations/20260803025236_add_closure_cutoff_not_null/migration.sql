/*
  Warnings:

  - Made the column `calendarDaysConsidered` on table `MonthClosure` required. This step will fail if there are existing NULL values in that column.
  - Made the column `calendarDaysTotal` on table `MonthClosure` required. This step will fail if there are existing NULL values in that column.
  - Made the column `cutoffDate` on table `MonthClosure` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workingDaysConsidered` on table `MonthClosure` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workingHoursConsidered` on table `MonthClosure` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MonthClosure" ALTER COLUMN "calendarDaysConsidered" SET NOT NULL,
ALTER COLUMN "calendarDaysTotal" SET NOT NULL,
ALTER COLUMN "cutoffDate" SET NOT NULL,
ALTER COLUMN "workingDaysConsidered" SET NOT NULL,
ALTER COLUMN "workingHoursConsidered" SET NOT NULL;
