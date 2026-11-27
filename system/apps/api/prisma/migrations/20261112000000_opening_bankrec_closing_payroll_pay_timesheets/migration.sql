-- AlterTable
ALTER TABLE "fiscal_periods" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" UUID,
ADD COLUMN     "closingJournalId" UUID;

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidBankAccountId" UUID,
ADD COLUMN     "paymentJournalId" UUID;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "billingProductId" UUID,
ADD COLUMN     "hourlyRate" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "task_time_logs" ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoiceId" UUID;

-- AlterTable
ALTER TABLE "trade_documents" ADD COLUMN     "isOpening" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxInvoiceNumber" VARCHAR(40);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(100),
    "amount" DECIMAL(18,2) NOT NULL,
    "cashTransactionId" UUID,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_recon_matches" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "journalLineId" UUID NOT NULL,
    "matchedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_recon_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statements_companyId_bankAccountId_idx" ON "bank_statements"("companyId", "bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_companyId_number_key" ON "bank_statements"("companyId", "number");

-- CreateIndex
CREATE INDEX "bank_statement_lines_statementId_idx" ON "bank_statement_lines"("statementId");

-- CreateIndex
CREATE INDEX "bank_recon_matches_lineId_idx" ON "bank_recon_matches"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_recon_matches_journalLineId_key" ON "bank_recon_matches"("journalLineId");

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_recon_matches" ADD CONSTRAINT "bank_recon_matches_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "bank_statement_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

