-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "plantation_divisions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "assistantId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plantation_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantation_blocks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "siteId" UUID NOT NULL,
    "divisionId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150),
    "crop" VARCHAR(12) NOT NULL DEFAULT 'OIL_PALM',
    "variety" VARCHAR(100),
    "plantingYear" INTEGER,
    "plantingDate" DATE,
    "areaHa" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "stands" INTEGER NOT NULL DEFAULT 0,
    "phase" VARCHAR(10) NOT NULL DEFAULT 'TBM',
    "matureDate" DATE,
    "bjrKg" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "landTitle" VARCHAR(100),
    "geometry" JSONB,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "tbmCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fixedAssetId" UUID,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plantation_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantation_activities" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(12) NOT NULL DEFAULT 'UPKEEP',
    "uom" VARCHAR(10) NOT NULL DEFAULT 'HA',
    "wageBasis" VARCHAR(6) NOT NULL DEFAULT 'DAILY',
    "dailyRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pieceRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseTask" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "premiumRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penaltyUnripe" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penaltyLongStalk" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penaltyLooseLeft" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penaltyOther" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expenseAccountId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plantation_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantation_workdays" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "siteId" UUID NOT NULL,
    "divisionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "foremanId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "warehouseId" UUID,
    "totalHk" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalWage" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalMaterial" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plantation_workdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantation_works" (
    "id" UUID NOT NULL,
    "workdayId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "hk" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "qty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tph" VARCHAR(20),
    "bunches" INTEGER NOT NULL DEFAULT 0,
    "looseFruitKg" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unripe" INTEGER NOT NULL DEFAULT 0,
    "longStalk" INTEGER NOT NULL DEFAULT 0,
    "looseLeft" INTEGER NOT NULL DEFAULT 0,
    "otherFaults" INTEGER NOT NULL DEFAULT 0,
    "wage" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "premium" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capitalised" BOOLEAN NOT NULL DEFAULT false,
    "payrollRunId" UUID,
    "notes" VARCHAR(300),

    CONSTRAINT "plantation_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantation_materials" (
    "id" UUID NOT NULL,
    "workdayId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "blockId" UUID NOT NULL,
    "activityId" UUID,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capitalised" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plantation_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ffb_dispatches" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "siteId" UUID NOT NULL,
    "divisionId" UUID,
    "vehicleNo" VARCHAR(20),
    "driver" VARCHAR(100),
    "customerId" UUID,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "ticketNo" VARCHAR(40),
    "weighedAt" TIMESTAMP(3),
    "grossKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tareKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortingPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "sortingKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grading" JSONB,
    "acceptedKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pricePerKg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deliveryDocId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ffb_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ffb_dispatch_lines" (
    "id" UUID NOT NULL,
    "dispatchId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "tph" VARCHAR(20),
    "bunches" INTEGER NOT NULL DEFAULT 0,
    "looseFruitKg" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estimatedKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actualKg" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ffb_dispatch_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plantation_divisions_companyId_code_key" ON "plantation_divisions"("companyId", "code");

-- CreateIndex
CREATE INDEX "plantation_blocks_divisionId_idx" ON "plantation_blocks"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "plantation_blocks_companyId_code_key" ON "plantation_blocks"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "plantation_activities_companyId_code_key" ON "plantation_activities"("companyId", "code");

-- CreateIndex
CREATE INDEX "plantation_workdays_companyId_date_idx" ON "plantation_workdays"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "plantation_workdays_companyId_number_key" ON "plantation_workdays"("companyId", "number");

-- CreateIndex
CREATE INDEX "plantation_works_companyId_employeeId_date_idx" ON "plantation_works"("companyId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "plantation_works_blockId_date_idx" ON "plantation_works"("blockId", "date");

-- CreateIndex
CREATE INDEX "plantation_materials_blockId_date_idx" ON "plantation_materials"("blockId", "date");

-- CreateIndex
CREATE INDEX "ffb_dispatches_companyId_date_idx" ON "ffb_dispatches"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ffb_dispatches_companyId_number_key" ON "ffb_dispatches"("companyId", "number");

-- CreateIndex
CREATE INDEX "ffb_dispatch_lines_blockId_idx" ON "ffb_dispatch_lines"("blockId");

-- AddForeignKey
ALTER TABLE "plantation_works" ADD CONSTRAINT "plantation_works_workdayId_fkey" FOREIGN KEY ("workdayId") REFERENCES "plantation_workdays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantation_materials" ADD CONSTRAINT "plantation_materials_workdayId_fkey" FOREIGN KEY ("workdayId") REFERENCES "plantation_workdays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ffb_dispatch_lines" ADD CONSTRAINT "ffb_dispatch_lines_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "ffb_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

