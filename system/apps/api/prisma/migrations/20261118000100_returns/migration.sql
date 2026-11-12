-- AlterTable
ALTER TABLE "trade_documents" ADD COLUMN     "creditedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "credit_applications" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "creditNoteId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_applications_creditNoteId_idx" ON "credit_applications"("creditNoteId");

-- CreateIndex
CREATE INDEX "credit_applications_invoiceId_idx" ON "credit_applications"("invoiceId");

