-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "trade_schemes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "supplierId" UUID,
    "type" VARCHAR(8) NOT NULL,
    "productIds" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "minQty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "discountPct" DECIMAL(6,3),
    "bonusProductId" UUID,
    "bonusQty" DECIMAL(18,4),
    "principalSharePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "claimType" VARCHAR(15) NOT NULL DEFAULT 'COMPENSATION',
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_usages" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "schemeId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "docType" VARCHAR(4) NOT NULL,
    "documentNumber" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "principalShare" DECIMAL(18,2) NOT NULL,
    "claimId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheme_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_records" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "schemeId" UUID,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "sourceDocId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "deliveryId" UUID,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "principal_claims" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "supplierId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "claimType" VARCHAR(15) NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'INVOICED',
    "invoiceId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "principal_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_schemes_companyId_code_key" ON "trade_schemes"("companyId", "code");

-- CreateIndex
CREATE INDEX "scheme_usages_companyId_schemeId_idx" ON "scheme_usages"("companyId", "schemeId");

-- CreateIndex
CREATE INDEX "scheme_usages_documentId_idx" ON "scheme_usages"("documentId");

-- CreateIndex
CREATE INDEX "scheme_usages_claimId_idx" ON "scheme_usages"("claimId");

-- CreateIndex
CREATE INDEX "gift_records_companyId_status_idx" ON "gift_records"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gift_records_companyId_number_key" ON "gift_records"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "principal_claims_companyId_number_key" ON "principal_claims"("companyId", "number");

