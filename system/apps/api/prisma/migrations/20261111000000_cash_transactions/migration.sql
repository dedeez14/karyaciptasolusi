-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "toBankAccountId" UUID,
    "accountId" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "partyName" VARCHAR(150),
    "costCenterId" UUID,
    "projectId" UUID,
    "reference" VARCHAR(100),
    "description" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_transactions_companyId_date_idx" ON "cash_transactions"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_companyId_number_key" ON "cash_transactions"("companyId", "number");

