-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dataConsentAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataConsentAcceptedAt" TIMESTAMP(3);
