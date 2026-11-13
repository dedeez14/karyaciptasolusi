-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "commodity_contracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "buyerRef" VARCHAR(60),
    "date" DATE NOT NULL,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "market" VARCHAR(8) NOT NULL,
    "channel" VARCHAR(8) NOT NULL DEFAULT 'DIRECT',
    "incoterm" VARCHAR(6) NOT NULL,
    "deliveryPoint" VARCHAR(150),
    "qtyKg" DECIMAL(16,2) NOT NULL,
    "tolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "price" DECIMAL(18,4) NOT NULL,
    "priceUnit" VARCHAR(2) NOT NULL DEFAULT 'KG',
    "taxId" UUID,
    "deliveryFrom" DATE,
    "deliveryTo" DATE,
    "spec" JSONB,
    "claims" JSONB,
    "paymentTerms" VARCHAR(150),
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "commodity_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commodity_deliveries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "warehouseId" UUID NOT NULL,
    "vehicle" VARCHAR(60),
    "sealNo" VARCHAR(60),
    "qtyKg" DECIMAL(16,2) NOT NULL,
    "ffa" DECIMAL(5,2),
    "mi" DECIMAL(5,2),
    "dobi" DECIMAL(5,2),
    "claimPct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "claimKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "invoiceKg" DECIMAL(16,2) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "shipmentId" UUID,
    "deliveryDocId" UUID,
    "invoiceDocId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "commodity_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_references" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "productId" UUID NOT NULL,
    "refPriceUsd" DECIMAL(14,2) NOT NULL,
    "dutyUsdPerMt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "levyPct" DECIMAL(6,3),
    "levyUsdPerMt" DECIMAL(14,2),
    "reference" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "export_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_shipments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "contractId" UUID NOT NULL,
    "pebNo" VARCHAR(40),
    "pebDate" DATE,
    "npeNo" VARCHAR(40),
    "npeDate" DATE,
    "vessel" VARCHAR(100),
    "blNo" VARCHAR(60),
    "blDate" DATE,
    "portOfLoading" VARCHAR(100),
    "portOfDischarge" VARCHAR(100),
    "destinationCountry" VARCHAR(3),
    "hsCode" VARCHAR(12),
    "surveyorReport" VARCHAR(60),
    "originCertificate" VARCHAR(60),
    "sustainabilityRef" VARCHAR(100),
    "eudrRef" VARCHAR(100),
    "qtyKg" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "fobUsd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "referenceId" UUID,
    "refPriceUsd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dutyUsdPerMt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "levyUsdPerMt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "dutyIdr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "levyIdr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dutyBilling" VARCHAR(60),
    "levyBilling" VARCHAR(60),
    "dheReceivedDate" DATE,
    "dheReceivedUsd" DECIMAL(18,2),
    "dheBank" VARCHAR(100),
    "dheRetainedUsd" DECIMAL(18,2),
    "dheRetainUntil" DATE,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "export_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commodity_contracts_companyId_status_idx" ON "commodity_contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commodity_contracts_companyId_number_key" ON "commodity_contracts"("companyId", "number");

-- CreateIndex
CREATE INDEX "commodity_deliveries_contractId_idx" ON "commodity_deliveries"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "commodity_deliveries_companyId_number_key" ON "commodity_deliveries"("companyId", "number");

-- CreateIndex
CREATE INDEX "export_references_companyId_productId_month_idx" ON "export_references"("companyId", "productId", "month");

-- CreateIndex
CREATE INDEX "export_shipments_companyId_status_idx" ON "export_shipments"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "export_shipments_companyId_number_key" ON "export_shipments"("companyId", "number");

