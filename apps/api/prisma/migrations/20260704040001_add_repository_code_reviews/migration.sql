-- CreateEnum
CREATE TYPE "CodeReviewSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "RepositoryCodeReview" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "CodeReviewSeverity" NOT NULL DEFAULT 'MEDIUM',
    "filePath" TEXT,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "suggestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryCodeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryCodeReview_repositoryId_idx" ON "RepositoryCodeReview"("repositoryId");

-- CreateIndex
CREATE INDEX "RepositoryCodeReview_severity_idx" ON "RepositoryCodeReview"("severity");

-- AddForeignKey
ALTER TABLE "RepositoryCodeReview" ADD CONSTRAINT "RepositoryCodeReview_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
