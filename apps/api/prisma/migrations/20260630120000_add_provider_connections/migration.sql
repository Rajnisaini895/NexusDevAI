-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectedByUserId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "installationId" TEXT,
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_installationId_key" ON "ProviderConnection"("installationId");

-- CreateIndex
CREATE INDEX "ProviderConnection_organizationId_idx" ON "ProviderConnection"("organizationId");

-- CreateIndex
CREATE INDEX "ProviderConnection_connectedByUserId_idx" ON "ProviderConnection"("connectedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_organizationId_provider_externalAccountId_key" ON "ProviderConnection"("organizationId", "provider", "externalAccountId");

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
