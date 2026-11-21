-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "bom_operations" ADD COLUMN     "kind" VARCHAR(12) NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "servicePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "supplierId" UUID,
ALTER COLUMN "workCenterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "work_order_operations" ADD COLUMN     "invoiceId" UUID,
ADD COLUMN     "kind" VARCHAR(12) NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "servicePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "supplierId" UUID,
ALTER COLUMN "workCenterId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(12) NOT NULL DEFAULT 'MACHINE',
    "workCenterId" UUID,
    "fixedAssetId" UUID,
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "serialNo" VARCHAR(100),
    "location" VARCHAR(150),
    "status" VARCHAR(10) NOT NULL DEFAULT 'RUNNING',
    "counterUnit" VARCHAR(10) NOT NULL DEFAULT 'HOURS',
    "counter" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inspectionCertNo" VARCHAR(100),
    "inspectionExpiry" DATE,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "intervalCounter" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "leadDays" INTEGER NOT NULL DEFAULT 3,
    "checklist" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lastDoneAt" DATE,
    "lastCounter" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "equipmentId" UUID NOT NULL,
    "planId" UUID,
    "type" VARCHAR(12) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "priority" VARCHAR(8) NOT NULL DEFAULT 'NORMAL',
    "description" TEXT NOT NULL,
    "dueDate" DATE,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "stopsEquipment" BOOLEAN NOT NULL DEFAULT false,
    "downtimeMinutes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "workDone" TEXT,
    "technician" VARCHAR(120),
    "labourHours" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "labourCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "partsCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "counterAtDone" DECIMAL(18,2),
    "warehouseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "maintenance_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_parts" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "maintenance_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downtime_events" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "workCenterId" UUID,
    "equipmentId" UUID,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "minutes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" VARCHAR(15) NOT NULL,
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceOrderId" UUID,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "downtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_companyId_code_key" ON "equipment"("companyId", "code");

-- CreateIndex
CREATE INDEX "maintenance_plans_companyId_equipmentId_idx" ON "maintenance_plans"("companyId", "equipmentId");

-- CreateIndex
CREATE INDEX "maintenance_orders_companyId_status_idx" ON "maintenance_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "maintenance_orders_equipmentId_idx" ON "maintenance_orders"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_orders_companyId_number_key" ON "maintenance_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "downtime_events_companyId_startAt_idx" ON "downtime_events"("companyId", "startAt");

-- AddForeignKey
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "maintenance_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

