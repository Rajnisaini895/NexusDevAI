CREATE TYPE "RepositoryProcessingStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "RepositoryProcessingStage" AS ENUM ('QUEUED', 'SYNCING', 'INGESTING', 'CHUNKING', 'EMBEDDING', 'COMPLETED', 'FAILED');

CREATE TABLE "RepositoryProcessingRun" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "RepositoryProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "RepositoryProcessingStage" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryProcessingRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RepositoryProcessingRun_repositoryId_createdAt_idx"
ON "RepositoryProcessingRun"("repositoryId", "createdAt");

CREATE INDEX "RepositoryProcessingRun_workspaceId_status_idx"
ON "RepositoryProcessingRun"("workspaceId", "status");

ALTER TABLE "RepositoryProcessingRun"
ADD CONSTRAINT "RepositoryProcessingRun_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
