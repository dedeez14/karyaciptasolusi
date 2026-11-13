-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "mill_tanks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'CPO',
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "capacityKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "calibration" JSONB,
    "calibrationTempC" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mill_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_tbs_prices" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "supplierType" VARCHAR(8) NOT NULL,
    "pricePerKg" DECIMAL(18,2) NOT NULL,
    "kIndex" DECIMAL(8,4),
    "cpoPrice" DECIMAL(18,2),
    "kernelPrice" DECIMAL(18,2),
    "cpoYield" DECIMAL(6,3),
    "kernelYield" DECIMAL(6,3),
    "shellValue" DECIMAL(18,2),
    "scope" VARCHAR(100),
    "reference" VARCHAR(150),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mill_tbs_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_intakes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "weighedAt" TIMESTAMP(3) NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierType" VARCHAR(8) NOT NULL,
    "origin" VARCHAR(150),
    "vehicleNo" VARCHAR(20),
    "driver" VARCHAR(100),
    "ticketNo" VARCHAR(40),
    "bunches" INTEGER NOT NULL DEFAULT 0,
    "grossKg" DECIMAL(14,2) NOT NULL,
    "tareKg" DECIMAL(14,2) NOT NULL,
    "netKg" DECIMAL(14,2) NOT NULL,
    "grading" JSONB,
    "sortingPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "sortingKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "acceptedKg" DECIMAL(14,2) NOT NULL,
    "pricePerKg" DECIMAL(18,2) NOT NULL,
    "priceId" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "receiptDocId" UUID,
    "invoiceDocId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "mill_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_dailies" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "tbsProductId" UUID NOT NULL,
    "tbsWarehouseId" UUID NOT NULL,
    "tbsOpeningKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tbsReceivedKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tbsProcessedKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "processingHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "breakdownHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "conversionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tbsCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "quality" JSONB,
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mill_dailies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_daily_outputs" (
    "id" UUID NOT NULL,
    "dailyId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "kind" VARCHAR(4) NOT NULL DEFAULT 'MAIN',
    "qty" DECIMAL(14,2) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "mill_daily_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_soundings" (
    "id" UUID NOT NULL,
    "dailyId" UUID NOT NULL,
    "tankId" UUID NOT NULL,
    "heightCm" DECIMAL(8,2),
    "temperatureC" DECIMAL(5,2),
    "volumeL" DECIMAL(14,2),
    "density" DECIMAL(8,5),
    "kg" DECIMAL(14,2) NOT NULL,
    "ffa" DECIMAL(5,2),

    CONSTRAINT "mill_soundings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mill_tanks_companyId_code_key" ON "mill_tanks"("companyId", "code");

-- CreateIndex
CREATE INDEX "mill_tbs_prices_companyId_supplierType_effectiveDate_idx" ON "mill_tbs_prices"("companyId", "supplierType", "effectiveDate");

-- CreateIndex
CREATE INDEX "mill_intakes_companyId_date_idx" ON "mill_intakes"("companyId", "date");

-- CreateIndex
CREATE INDEX "mill_intakes_supplierId_date_idx" ON "mill_intakes"("supplierId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "mill_intakes_companyId_number_key" ON "mill_intakes"("companyId", "number");

-- CreateIndex
CREATE INDEX "mill_dailies_companyId_date_idx" ON "mill_dailies"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "mill_dailies_companyId_number_key" ON "mill_dailies"("companyId", "number");

-- CreateIndex
CREATE INDEX "mill_daily_outputs_dailyId_idx" ON "mill_daily_outputs"("dailyId");

-- CreateIndex
CREATE UNIQUE INDEX "mill_soundings_dailyId_tankId_key" ON "mill_soundings"("dailyId", "tankId");

-- AddForeignKey
ALTER TABLE "mill_daily_outputs" ADD CONSTRAINT "mill_daily_outputs_dailyId_fkey" FOREIGN KEY ("dailyId") REFERENCES "mill_dailies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mill_soundings" ADD CONSTRAINT "mill_soundings_dailyId_fkey" FOREIGN KEY ("dailyId") REFERENCES "mill_dailies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

