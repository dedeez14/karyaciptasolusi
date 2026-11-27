-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "instalment_plans" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "customerId" UUID NOT NULL,
    "projectId" UUID,
    "kind" VARCHAR(8) NOT NULL,
    "productId" UUID,
    "taxId" UUID,
    "saleInvoiceId" UUID,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "downPayment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "firstDueDate" DATE NOT NULL,
    "leadDays" INTEGER NOT NULL DEFAULT 0,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT true,
    "lateFeePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "lateFeeCapPct" DECIMAL(6,2),
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "instalment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalment_lines" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "invoiceId" UUID,
    "lateFeeCharged" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "instalment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instalment_plans_companyId_status_idx" ON "instalment_plans"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "instalment_plans_companyId_number_key" ON "instalment_plans"("companyId", "number");

-- CreateIndex
CREATE INDEX "instalment_lines_planId_idx" ON "instalment_lines"("planId");

-- CreateIndex
CREATE INDEX "instalment_lines_invoiceId_idx" ON "instalment_lines"("invoiceId");

-- AddForeignKey
ALTER TABLE "instalment_lines" ADD CONSTRAINT "instalment_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES "instalment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

