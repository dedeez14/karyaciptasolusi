-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "carton_flutes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "walls" INTEGER NOT NULL DEFAULT 1,
    "caliper" DECIMAL(9,2) NOT NULL,
    "takeUp1" DECIMAL(9,4) NOT NULL,
    "takeUp2" DECIMAL(9,4),
    "allowLW" DECIMAL(9,2) NOT NULL,
    "allowH" DECIMAL(9,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carton_flutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carton_grades" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "fluteId" UUID NOT NULL,
    "layers" JSONB NOT NULL,
    "ectNm" DECIMAL(12,2),
    "burstKpa" DECIMAL(12,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "carton_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carton_specs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "customerId" UUID,
    "productId" UUID,
    "style" VARCHAR(6) NOT NULL,
    "lengthMm" DECIMAL(9,1) NOT NULL,
    "widthMm" DECIMAL(9,1) NOT NULL,
    "heightMm" DECIMAL(9,1) NOT NULL DEFAULT 0,
    "gradeId" UUID NOT NULL,
    "colours" INTEGER NOT NULL DEFAULT 0,
    "printCoveragePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "joint" VARCHAR(6) NOT NULL DEFAULT 'GLUE',
    "dieCut" BOOLEAN NOT NULL DEFAULT false,
    "blankLengthMm" DECIMAL(9,1),
    "blankWidthMm" DECIMAL(9,1),
    "bundleQty" INTEGER NOT NULL DEFAULT 25,
    "grossKg" DECIMAL(9,2),
    "stackHeight" INTEGER,
    "safetyFactor" DECIMAL(5,2) NOT NULL DEFAULT 4,
    "foodContact" VARCHAR(8) NOT NULL DEFAULT 'NONE',
    "foodType" VARCHAR(6),
    "inkType" VARCHAR(60),
    "printSide" VARCHAR(10),
    "migrationReport" VARCHAR(120),
    "migrationDate" DATE,
    "declarationUntil" DATE,
    "recycledPct" DECIMAL(5,2),
    "recycledApproval" VARCHAR(120),
    "animalInput" BOOLEAN NOT NULL DEFAULT false,
    "halalCertNo" VARCHAR(80),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "carton_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carton_estimates" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "specId" UUID NOT NULL,
    "customerId" UUID,
    "date" DATE NOT NULL,
    "kind" VARCHAR(6) NOT NULL DEFAULT 'GOODS',
    "quantities" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "toolingCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "billToolingSeparately" BOOLEAN NOT NULL DEFAULT true,
    "quotationId" UUID,
    "status" VARCHAR(6) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "carton_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carton_tools" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "kind" VARCHAR(5) NOT NULL,
    "specId" UUID,
    "customerId" UUID,
    "owner" VARCHAR(8) NOT NULL DEFAULT 'COMPANY',
    "colour" VARCHAR(40),
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "madeOn" DATE,
    "location" VARCHAR(80),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "lifeImpressions" INTEGER,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "carton_tools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carton_flutes_companyId_code_key" ON "carton_flutes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "carton_grades_companyId_code_key" ON "carton_grades"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "carton_specs_companyId_code_key" ON "carton_specs"("companyId", "code");

-- CreateIndex
CREATE INDEX "carton_estimates_companyId_specId_idx" ON "carton_estimates"("companyId", "specId");

-- CreateIndex
CREATE UNIQUE INDEX "carton_estimates_companyId_number_key" ON "carton_estimates"("companyId", "number");

-- CreateIndex
CREATE INDEX "carton_tools_companyId_specId_idx" ON "carton_tools"("companyId", "specId");

-- CreateIndex
CREATE UNIQUE INDEX "carton_tools_companyId_code_key" ON "carton_tools"("companyId", "code");

