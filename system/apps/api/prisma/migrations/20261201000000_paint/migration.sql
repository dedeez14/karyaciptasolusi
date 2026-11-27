-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "paint_colours" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "collection" VARCHAR(60),
    "L" DECIMAL(9,3) NOT NULL,
    "a" DECIMAL(9,3) NOT NULL,
    "b" DECIMAL(9,3) NOT NULL,
    "tolerance" DECIMAL(6,3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "paint_colours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paint_bases" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "productLine" VARCHAR(60),
    "baseType" VARCHAR(8) NOT NULL,
    "maxColorantPct" DECIMAL(6,2) NOT NULL,
    "cans" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paint_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paint_colorants" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "productId" UUID NOT NULL,
    "unitMl" DECIMAL(12,3) NOT NULL DEFAULT 1000,
    "hex" VARCHAR(7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paint_colorants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tint_formulas" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "colourId" UUID NOT NULL,
    "baseId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lines" JSONB NOT NULL,
    "drawL" DECIMAL(9,3),
    "drawA" DECIMAL(9,3),
    "drawB" DECIMAL(9,3),
    "dE00" DECIMAL(6,3),
    "status" VARCHAR(8) NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "tint_formulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tint_jobs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "warehouseId" UUID NOT NULL,
    "customerId" UUID,
    "colourId" UUID NOT NULL,
    "formulaId" UUID NOT NULL,
    "baseProductId" UUID NOT NULL,
    "canLitres" DECIMAL(9,3) NOT NULL,
    "cans" INTEGER NOT NULL,
    "dispensed" JSONB NOT NULL,
    "baseCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "colorantCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tintFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoiceId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DONE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "tint_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colour_checks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "workOrderId" UUID,
    "productId" UUID NOT NULL,
    "lotNo" VARCHAR(60),
    "colourId" UUID NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "L" DECIMAL(9,3) NOT NULL,
    "a" DECIMAL(9,3) NOT NULL,
    "b" DECIMAL(9,3) NOT NULL,
    "dE76" DECIMAL(6,3) NOT NULL,
    "dE00" DECIMAL(6,3) NOT NULL,
    "tolerance" DECIMAL(6,3) NOT NULL,
    "pass" BOOLEAN NOT NULL,
    "reading" VARCHAR(80),
    "additions" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "colour_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_sds" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "revisionDate" DATE NOT NULL,
    "nextReview" DATE NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'ID',
    "hazardClasses" VARCHAR(500),
    "pictograms" JSONB NOT NULL,
    "signalWord" VARCHAR(8) NOT NULL DEFAULT 'NONE',
    "hStatements" JSONB NOT NULL,
    "pStatements" JSONB NOT NULL,
    "components" JSONB NOT NULL,
    "flashPointC" DECIMAL(7,2),
    "boilingPointC" DECIMAL(7,2),
    "unNumber" VARCHAR(10),
    "shippingName" VARCHAR(120),
    "transportClass" VARCHAR(10),
    "packingGroup" VARCHAR(4),
    "leadPpm" DECIMAL(10,2),
    "vocGL" DECIMAL(10,2),
    "notes" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "product_sds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paint_colours_companyId_code_key" ON "paint_colours"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "paint_bases_companyId_code_key" ON "paint_bases"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "paint_colorants_companyId_code_key" ON "paint_colorants"("companyId", "code");

-- CreateIndex
CREATE INDEX "tint_formulas_companyId_colourId_baseId_idx" ON "tint_formulas"("companyId", "colourId", "baseId");

-- CreateIndex
CREATE INDEX "tint_jobs_companyId_date_idx" ON "tint_jobs"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tint_jobs_companyId_number_key" ON "tint_jobs"("companyId", "number");

-- CreateIndex
CREATE INDEX "colour_checks_companyId_workOrderId_idx" ON "colour_checks"("companyId", "workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "colour_checks_companyId_number_key" ON "colour_checks"("companyId", "number");

-- CreateIndex
CREATE INDEX "product_sds_companyId_productId_idx" ON "product_sds"("companyId", "productId");

