-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "bom_lines" ADD COLUMN     "operationSeq" INTEGER,
ADD COLUMN     "pct" DECIMAL(9,4),
ADD COLUMN     "phantom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "boms" ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "normalScrapPct" DECIMAL(9,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "work_order_lines" ADD COLUMN     "issuedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "operationSeq" INTEGER;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "abnormalLoss" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "byProductValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "parentId" UUID,
ADD COLUMN     "scrapQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "standardCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "wipConversion" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wipMaterial" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "work_centers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "labourRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "machineRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overheadRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capacityHours" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stations" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "work_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_operations" (
    "id" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "workCenterId" UUID NOT NULL,
    "setupMinutes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "runMinutes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "instructions" VARCHAR(1000),

    CONSTRAINT "bom_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_outputs" (
    "id" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kind" VARCHAR(5) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "costSharePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "nrvPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "bom_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_operations" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "workCenterId" UUID NOT NULL,
    "plannedMinutes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualMinutes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "goodQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrapQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "runningSince" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "operatorId" UUID,
    "labourRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "machineRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overheadRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "appliedCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),

    CONSTRAINT "work_order_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_outputs" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kind" VARCHAR(5) NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "producedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costSharePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "nrvPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_centers_companyId_code_key" ON "work_centers"("companyId", "code");

-- CreateIndex
CREATE INDEX "work_order_operations_workOrderId_idx" ON "work_order_operations"("workOrderId");

-- CreateIndex
CREATE INDEX "work_order_operations_workCenterId_status_idx" ON "work_order_operations"("workCenterId", "status");

-- AddForeignKey
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_outputs" ADD CONSTRAINT "bom_outputs_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_outputs" ADD CONSTRAINT "work_order_outputs_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

