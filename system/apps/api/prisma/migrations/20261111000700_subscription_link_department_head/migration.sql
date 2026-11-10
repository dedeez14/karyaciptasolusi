-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "managerId" UUID;

-- AlterTable
ALTER TABLE "trade_documents" ADD COLUMN     "subscriptionId" UUID;

-- CreateIndex
CREATE INDEX "trade_documents_subscriptionId_idx" ON "trade_documents"("subscriptionId");

