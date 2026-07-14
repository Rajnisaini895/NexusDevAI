-- AlterTable
ALTER TABLE "PullRequestReviewRun"
ADD COLUMN "githubCheckRunId" TEXT,
ADD COLUMN "githubCheckRunUrl" TEXT;
