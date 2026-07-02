-- AlterTable
ALTER TABLE "Repository"
ADD COLUMN "url" TEXT,
ADD COLUMN "isPrivate" BOOLEAN,
ADD COLUMN "providerConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "Repository_providerConnectionId_idx" ON "Repository"("providerConnectionId");

-- AddForeignKey
ALTER TABLE "Repository"
ADD CONSTRAINT "Repository_providerConnectionId_fkey"
FOREIGN KEY ("providerConnectionId") REFERENCES "ProviderConnection"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
