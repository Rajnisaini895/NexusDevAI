-- CreateEnum
CREATE TYPE "GitHubPullRequestState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PullRequestReviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "GitHubPullRequest" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorLogin" TEXT,
    "baseSha" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "state" "GitHubPullRequestState" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestReviewRun" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" "PullRequestReviewStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "filesReviewed" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "githubReviewId" TEXT,
    "githubReviewUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestReviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubPullRequest_repositoryId_number_key" ON "GitHubPullRequest"("repositoryId", "number");
CREATE INDEX "GitHubPullRequest_repositoryId_state_idx" ON "GitHubPullRequest"("repositoryId", "state");
CREATE UNIQUE INDEX "PullRequestReviewRun_pullRequestId_headSha_key" ON "PullRequestReviewRun"("pullRequestId", "headSha");
CREATE UNIQUE INDEX "PullRequestReviewRun_repositoryId_deliveryId_key" ON "PullRequestReviewRun"("repositoryId", "deliveryId");
CREATE INDEX "PullRequestReviewRun_repositoryId_createdAt_idx" ON "PullRequestReviewRun"("repositoryId", "createdAt");
CREATE INDEX "PullRequestReviewRun_status_createdAt_idx" ON "PullRequestReviewRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PullRequestReviewRun" ADD CONSTRAINT "PullRequestReviewRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PullRequestReviewRun" ADD CONSTRAINT "PullRequestReviewRun_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "GitHubPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
