-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "farm_sites" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(12) NOT NULL DEFAULT 'LIVESTOCK',
    "ownership" VARCHAR(10) NOT NULL DEFAULT 'OWN',
    "partnerId" UUID,
    "address" TEXT,
    "regency" VARCHAR(100),
    "registrationNo" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "farm_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_units" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'HOUSE',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "areaM2" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "farm_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_cycles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "siteId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "species" VARCHAR(10) NOT NULL,
    "strain" VARCHAR(100),
    "status" VARCHAR(10) NOT NULL DEFAULT 'PLANNED',
    "phase" VARCHAR(8) NOT NULL DEFAULT 'GROWING',
    "placementDate" DATE NOT NULL,
    "initialQty" INTEGER NOT NULL,
    "initialAgeDays" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" UUID NOT NULL,
    "stockProductId" UUID,
    "outputProductId" UUID,
    "cullProductId" UUID,
    "eggProductId" UUID,
    "eggUnit" VARCHAR(3) NOT NULL DEFAULT 'KG',
    "contractId" UUID,
    "targetFcr" DECIMAL(9,3),
    "targetWeightKg" DECIMAL(9,3),
    "targetAgeDays" INTEGER,
    "layStartDate" DATE,
    "expectedLayWeeks" INTEGER NOT NULL DEFAULT 0,
    "rearingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rearingAmortised" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amortisedTo" DATE,
    "layingPool" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "mortality" INTEGER NOT NULL DEFAULT 0,
    "culled" INTEGER NOT NULL DEFAULT 0,
    "harvestedQty" INTEGER NOT NULL DEFAULT 0,
    "harvestedKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "feedKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "eggsGood" INTEGER NOT NULL DEFAULT 0,
    "eggsKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "costIn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costOut" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "abnormalLoss" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withdrawalUntil" DATE,
    "closedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "livestock_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_daily" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "mortality" INTEGER NOT NULL DEFAULT 0,
    "culled" INTEGER NOT NULL DEFAULT 0,
    "abnormal" BOOLEAN NOT NULL DEFAULT false,
    "feedProductId" UUID,
    "feedKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "waterL" DECIMAL(18,2),
    "avgWeightG" DECIMAL(18,2),
    "sampleSize" INTEGER,
    "eggsGood" INTEGER NOT NULL DEFAULT 0,
    "eggsCracked" INTEGER NOT NULL DEFAULT 0,
    "eggsKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "tempMin" DECIMAL(6,2),
    "tempMax" DECIMAL(6,2),
    "humidity" DECIMAL(6,2),
    "waterQuality" JSONB,
    "notes" VARCHAR(1000),
    "feedCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lossValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "eggCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amortisation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "poolBefore" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amortisedToBefore" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "livestock_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_treatments" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DONE',
    "date" DATE NOT NULL,
    "productId" UUID,
    "description" VARCHAR(200) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "method" VARCHAR(40),
    "withdrawalDays" INTEGER NOT NULL DEFAULT 0,
    "withdrawalUntil" DATE,
    "vet" VARCHAR(120),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "livestock_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_costs" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sourceType" VARCHAR(10),
    "sourceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_harvests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'HARVEST',
    "qty" INTEGER NOT NULL,
    "weightKg" DECIMAL(18,3) NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "customerId" UUID,
    "pricePerKg" DECIMAL(18,2),
    "fairValue" DECIMAL(18,2),
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deliveryNo" VARCHAR(60),
    "vehicleNo" VARCHAR(30),
    "overrideReason" VARCHAR(300),
    "deliveryDocId" UUID,
    "notes" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "livestock_harvests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_contracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "partnerId" UUID NOT NULL,
    "siteId" UUID,
    "species" VARCHAR(10) NOT NULL DEFAULT 'BROILER',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "docPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feedPrices" JSONB NOT NULL DEFAULT '[]',
    "medicineMarkupPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "priceBands" JSONB NOT NULL DEFAULT '[]',
    "standardFcr" DECIMAL(9,3),
    "fcrBonusPerPoint" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ipThreshold" DECIMAL(9,2),
    "ipBonusPerKg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withholdPph22" BOOLEAN NOT NULL DEFAULT false,
    "carryForward" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "acknowledgedBy" VARCHAR(150),
    "acknowledgedAt" DATE,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "partner_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "contractId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "harvestQty" INTEGER NOT NULL,
    "harvestKg" DECIMAL(18,3) NOT NULL,
    "avgWeightKg" DECIMAL(9,3) NOT NULL,
    "pricePerKg" DECIMAL(18,2) NOT NULL,
    "revenue" DECIMAL(18,2) NOT NULL,
    "docCharge" DECIMAL(18,2) NOT NULL,
    "feedCharge" DECIMAL(18,2) NOT NULL,
    "medicineCharge" DECIMAL(18,2) NOT NULL,
    "fcr" DECIMAL(9,3) NOT NULL,
    "ip" DECIMAL(9,2) NOT NULL,
    "fcrBonus" DECIMAL(18,2) NOT NULL,
    "ipBonus" DECIMAL(18,2) NOT NULL,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "carriedIn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL,
    "invoiceId" UUID,
    "notes" VARCHAR(1000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "partner_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farm_sites_companyId_code_key" ON "farm_sites"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "farm_units_companyId_code_key" ON "farm_units"("companyId", "code");

-- CreateIndex
CREATE INDEX "livestock_cycles_companyId_status_idx" ON "livestock_cycles"("companyId", "status");

-- CreateIndex
CREATE INDEX "livestock_cycles_unitId_idx" ON "livestock_cycles"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_cycles_companyId_number_key" ON "livestock_cycles"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_daily_cycleId_date_key" ON "livestock_daily"("cycleId", "date");

-- CreateIndex
CREATE INDEX "livestock_treatments_cycleId_date_idx" ON "livestock_treatments"("cycleId", "date");

-- CreateIndex
CREATE INDEX "livestock_costs_cycleId_date_idx" ON "livestock_costs"("cycleId", "date");

-- CreateIndex
CREATE INDEX "livestock_harvests_cycleId_idx" ON "livestock_harvests"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_harvests_companyId_number_key" ON "livestock_harvests"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "partner_contracts_companyId_number_key" ON "partner_contracts"("companyId", "number");

-- CreateIndex
CREATE INDEX "partner_settlements_cycleId_idx" ON "partner_settlements"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_companyId_number_key" ON "partner_settlements"("companyId", "number");

-- AddForeignKey
ALTER TABLE "livestock_daily" ADD CONSTRAINT "livestock_daily_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "livestock_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_treatments" ADD CONSTRAINT "livestock_treatments_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "livestock_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_costs" ADD CONSTRAINT "livestock_costs_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "livestock_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

