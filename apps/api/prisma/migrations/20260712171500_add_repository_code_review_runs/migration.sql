CREATE TABLE "RepositoryCodeReviewRun" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "chunksReviewed" INTEGER NOT NULL,
    "issuesFound" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryCodeReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RepositoryCodeReviewRun_repositoryId_createdAt_idx"
ON "RepositoryCodeReviewRun"("repositoryId", "createdAt");

ALTER TABLE "RepositoryCodeReviewRun"
ADD CONSTRAINT "RepositoryCodeReviewRun_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
