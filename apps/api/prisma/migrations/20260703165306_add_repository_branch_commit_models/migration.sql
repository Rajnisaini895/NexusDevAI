-- CreateTable
CREATE TABLE "RepositoryBranch" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sha" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryCommit" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "committedAt" TIMESTAMP(3),
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryCommit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryBranch_repositoryId_idx" ON "RepositoryBranch"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryBranch_repositoryId_name_key" ON "RepositoryBranch"("repositoryId", "name");

-- CreateIndex
CREATE INDEX "RepositoryCommit_repositoryId_idx" ON "RepositoryCommit"("repositoryId");

-- CreateIndex
CREATE INDEX "RepositoryCommit_sha_idx" ON "RepositoryCommit"("sha");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryCommit_repositoryId_sha_key" ON "RepositoryCommit"("repositoryId", "sha");

-- AddForeignKey
ALTER TABLE "RepositoryBranch" ADD CONSTRAINT "RepositoryBranch_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCommit" ADD CONSTRAINT "RepositoryCommit_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
