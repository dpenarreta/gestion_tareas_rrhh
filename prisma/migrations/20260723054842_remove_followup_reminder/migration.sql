-- DropForeignKey
ALTER TABLE "FollowUpReminder" DROP CONSTRAINT "FollowUpReminder_taskId_fkey";

-- DropForeignKey
ALTER TABLE "FollowUpReminder" DROP CONSTRAINT "FollowUpReminder_userId_fkey";

-- DropTable
DROP TABLE "FollowUpReminder";
