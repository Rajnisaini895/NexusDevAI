-- CreateTable
CREATE TABLE "RepositoryChunk" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "language" TEXT,
    "sourceSha" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryChunk_repositoryId_idx" ON "RepositoryChunk"("repositoryId");
CREATE INDEX "RepositoryChunk_fileId_idx" ON "RepositoryChunk"("fileId");
CREATE INDEX "RepositoryChunk_repositoryId_language_idx" ON "RepositoryChunk"("repositoryId", "language");
CREATE INDEX "RepositoryChunk_contentHash_idx" ON "RepositoryChunk"("contentHash");
CREATE UNIQUE INDEX "RepositoryChunk_fileId_chunkIndex_key" ON "RepositoryChunk"("fileId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "RepositoryChunk" ADD CONSTRAINT "RepositoryChunk_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryChunk" ADD CONSTRAINT "RepositoryChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "RepositoryFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
