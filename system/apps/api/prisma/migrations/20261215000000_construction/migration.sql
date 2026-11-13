-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "construction_contracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "projectId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "contractNo" VARCHAR(60) NOT NULL,
    "contractDate" DATE NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "contractValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vat" BOOLEAN NOT NULL DEFAULT true,
    "govCollector" BOOLEAN NOT NULL DEFAULT false,
    "serviceKind" VARCHAR(12) NOT NULL DEFAULT 'WORK',
    "qualification" VARCHAR(6) NOT NULL DEFAULT 'SMALL',
    "pphRate" DECIMAL(6,3) NOT NULL DEFAULT 1.75,
    "advancePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceInvoiceId" UUID,
    "retentionPct" DECIMAL(6,3) NOT NULL DEFAULT 5,
    "maintenanceDays" INTEGER NOT NULL DEFAULT 180,
    "startDate" DATE,
    "finishDate" DATE,
    "phoDate" DATE,
    "retentionInvoiceId" UUID,
    "fhoDate" DATE,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "construction_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "budgetUnitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costType" VARCHAR(10) NOT NULL DEFAULT 'MIXED',
    "certifiedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_certificates" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "seq" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "cumulativeValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "previousValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "thisValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecovery" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retention" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoiceId" UUID,
    "clientRef" VARCHAR(80),
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "progress_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_certificate_lines" (
    "id" UUID NOT NULL,
    "certificateId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "prevQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cumQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "thisQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "thisValue" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "progress_certificate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "scope" VARCHAR(300) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "retentionPct" DECIMAL(6,3) NOT NULL DEFAULT 5,
    "vat" BOOLEAN NOT NULL DEFAULT true,
    "pphRate" DECIMAL(6,3) NOT NULL DEFAULT 1.75,
    "claimedPct" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "retentionHeld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retentionReleaseId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "subcontracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_claims" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "subcontractId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "prevPct" DECIMAL(7,3) NOT NULL,
    "cumPct" DECIMAL(7,3) NOT NULL,
    "thisValue" DECIMAL(18,2) NOT NULL,
    "retention" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "supplierRef" VARCHAR(80),
    "invoiceId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "subcontract_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_tax_self_pay" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "construction_tax_self_pay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "construction_contracts_companyId_status_idx" ON "construction_contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "construction_contracts_projectId_key" ON "construction_contracts"("projectId");

-- CreateIndex
CREATE INDEX "boq_items_contractId_idx" ON "boq_items"("contractId");

-- CreateIndex
CREATE INDEX "progress_certificates_contractId_idx" ON "progress_certificates"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "progress_certificates_companyId_number_key" ON "progress_certificates"("companyId", "number");

-- CreateIndex
CREATE INDEX "progress_certificate_lines_certificateId_idx" ON "progress_certificate_lines"("certificateId");

-- CreateIndex
CREATE INDEX "progress_certificate_lines_boqItemId_idx" ON "progress_certificate_lines"("boqItemId");

-- CreateIndex
CREATE INDEX "subcontracts_contractId_idx" ON "subcontracts"("contractId");

-- CreateIndex
CREATE INDEX "subcontract_claims_subcontractId_idx" ON "subcontract_claims"("subcontractId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_claims_companyId_number_key" ON "subcontract_claims"("companyId", "number");

-- CreateIndex
CREATE INDEX "construction_tax_self_pay_companyId_period_idx" ON "construction_tax_self_pay"("companyId", "period");

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "construction_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_certificates" ADD CONSTRAINT "progress_certificates_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "construction_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_certificate_lines" ADD CONSTRAINT "progress_certificate_lines_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "progress_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "construction_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_claims" ADD CONSTRAINT "subcontract_claims_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

