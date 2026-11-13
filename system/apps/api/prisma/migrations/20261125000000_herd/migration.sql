-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "animals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "tagNo" VARCHAR(40) NOT NULL,
    "nationalId" VARCHAR(60),
    "name" VARCHAR(100),
    "species" VARCHAR(8) NOT NULL DEFAULT 'CATTLE',
    "breed" VARCHAR(80),
    "sex" VARCHAR(1) NOT NULL,
    "purpose" VARCHAR(10) NOT NULL,
    "birthDate" DATE,
    "birthWeightKg" DECIMAL(8,2),
    "origin" VARCHAR(10) NOT NULL,
    "damId" UUID,
    "sire" VARCHAR(60),
    "siteId" UUID NOT NULL,
    "unitId" UUID,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    "reproStatus" VARCHAR(8) NOT NULL DEFAULT 'OPEN',
    "lactating" BOOLEAN NOT NULL DEFAULT false,
    "lactationNo" INTEGER NOT NULL DEFAULT 0,
    "lastCalving" DATE,
    "lastService" DATE,
    "servicesSinceCalving" INTEGER NOT NULL DEFAULT 0,
    "expectedCalving" DATE,
    "dryOffDate" DATE,
    "lastWeightKg" DECIMAL(8,2),
    "lastWeighDate" DATE,
    "milkWithdrawalUntil" DATE,
    "meatWithdrawalUntil" DATE,
    "acquisitionDate" DATE NOT NULL,
    "acquisitionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "supplierId" UUID,
    "purchaseDocId" UUID,
    "carryingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fixedAssetId" UUID,
    "productiveDate" DATE,
    "exitDate" DATE,
    "exitReason" VARCHAR(150),
    "exitWeightKg" DECIMAL(8,2),
    "exitValue" DECIMAL(18,2),
    "exitCost" DECIMAL(18,2),
    "saleDocId" UUID,
    "customerId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_weights" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kg" DECIMAL(8,2) NOT NULL,
    "bcs" DECIMAL(3,1),
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "animal_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_events" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "method" VARCHAR(10),
    "sire" VARCHAR(60),
    "technician" VARCHAR(100),
    "result" VARCHAR(10),
    "fromUnitId" UUID,
    "toUnitId" UUID,
    "data" JSONB,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "animal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_treatments" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "diagnosis" VARCHAR(150),
    "productId" UUID,
    "qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "milkWithdrawalDays" INTEGER NOT NULL DEFAULT 0,
    "meatWithdrawalDays" INTEGER NOT NULL DEFAULT 0,
    "vet" VARCHAR(100),
    "batchId" UUID NOT NULL,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "animal_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_costs" (
    "id" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "capitalised" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" VARCHAR(10) NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animal_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "herd_feedings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "unitId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "heads" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "herd_feedings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milk_records" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "session" VARCHAR(2) NOT NULL,
    "liters" DECIMAL(8,2) NOT NULL,
    "discarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "milk_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milk_price_schemes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "basePrice" DECIMAL(18,2) NOT NULL,
    "fatStd" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fatStep" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tsStd" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tsStep" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tpcGrades" JSONB,
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "milk_price_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milk_deliveries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "session" VARCHAR(3) NOT NULL DEFAULT 'DAY',
    "customerId" UUID NOT NULL,
    "liters" DECIMAL(12,2) NOT NULL,
    "fat" DECIMAL(5,2),
    "snf" DECIMAL(5,2),
    "ts" DECIMAL(5,2),
    "protein" DECIMAL(5,2),
    "tpc" DECIMAL(14,0),
    "density" DECIMAL(6,4),
    "alcoholTest" BOOLEAN,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "pricePerLiter" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "priceDetail" JSONB,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "invoiceDocId" UUID,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "milk_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "animals_companyId_status_idx" ON "animals"("companyId", "status");

-- CreateIndex
CREATE INDEX "animals_unitId_idx" ON "animals"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "animals_companyId_tagNo_key" ON "animals"("companyId", "tagNo");

-- CreateIndex
CREATE INDEX "animal_weights_animalId_date_idx" ON "animal_weights"("animalId", "date");

-- CreateIndex
CREATE INDEX "animal_events_animalId_date_idx" ON "animal_events"("animalId", "date");

-- CreateIndex
CREATE INDEX "animal_treatments_animalId_date_idx" ON "animal_treatments"("animalId", "date");

-- CreateIndex
CREATE INDEX "animal_treatments_batchId_idx" ON "animal_treatments"("batchId");

-- CreateIndex
CREATE INDEX "animal_costs_animalId_date_idx" ON "animal_costs"("animalId", "date");

-- CreateIndex
CREATE INDEX "animal_costs_sourceId_idx" ON "animal_costs"("sourceId");

-- CreateIndex
CREATE INDEX "herd_feedings_companyId_date_idx" ON "herd_feedings"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "herd_feedings_companyId_number_key" ON "herd_feedings"("companyId", "number");

-- CreateIndex
CREATE INDEX "milk_records_companyId_date_idx" ON "milk_records"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "milk_records_animalId_date_session_key" ON "milk_records"("animalId", "date", "session");

-- CreateIndex
CREATE INDEX "milk_price_schemes_companyId_customerId_effectiveDate_idx" ON "milk_price_schemes"("companyId", "customerId", "effectiveDate");

-- CreateIndex
CREATE INDEX "milk_deliveries_companyId_date_idx" ON "milk_deliveries"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "milk_deliveries_companyId_number_key" ON "milk_deliveries"("companyId", "number");

