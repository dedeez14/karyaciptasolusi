-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "stock_lots" ADD COLUMN     "qcStatus" VARCHAR(10) NOT NULL DEFAULT 'RELEASED';

-- CreateTable
CREATE TABLE "qc_plans" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "stage" VARCHAR(12) NOT NULL,
    "productId" UUID,
    "categoryId" UUID,
    "sampling" VARCHAR(200),
    "holdLots" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "qc_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_plan_params" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "unit" VARCHAR(20),
    "min" DECIMAL(18,6),
    "max" DECIMAL(18,6),
    "target" DECIMAL(18,6),
    "method" VARCHAR(200),
    "critical" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "qc_plan_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspections" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "planId" UUID NOT NULL,
    "stage" VARCHAR(12) NOT NULL,
    "productId" UUID NOT NULL,
    "sourceType" VARCHAR(10) NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceNumber" VARCHAR(40) NOT NULL,
    "lotId" UUID,
    "lotNo" VARCHAR(60),
    "qty" DECIMAL(18,4) NOT NULL,
    "sampleQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "inspectedAt" TIMESTAMP(3),
    "inspectorId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_results" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "unit" VARCHAR(20),
    "min" DECIMAL(18,6),
    "max" DECIMAL(18,6),
    "method" VARCHAR(200),
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "valueNumber" DECIMAL(18,6),
    "valueText" VARCHAR(500),
    "pass" BOOLEAN,

    CONSTRAINT "qc_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_ncrs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "inspectionId" UUID,
    "productId" UUID NOT NULL,
    "lotId" UUID,
    "lotNo" VARCHAR(60),
    "supplierId" UUID,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "disposition" VARCHAR(12),
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "dueDate" DATE,
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "qc_ncrs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_plans_companyId_code_key" ON "qc_plans"("companyId", "code");

-- CreateIndex
CREATE INDEX "qc_inspections_companyId_status_idx" ON "qc_inspections"("companyId", "status");

-- CreateIndex
CREATE INDEX "qc_inspections_sourceType_sourceId_idx" ON "qc_inspections"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_inspections_companyId_number_key" ON "qc_inspections"("companyId", "number");

-- CreateIndex
CREATE INDEX "qc_ncrs_companyId_status_idx" ON "qc_ncrs"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qc_ncrs_companyId_number_key" ON "qc_ncrs"("companyId", "number");

-- AddForeignKey
ALTER TABLE "qc_plan_params" ADD CONSTRAINT "qc_plan_params_planId_fkey" FOREIGN KEY ("planId") REFERENCES "qc_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "qc_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

