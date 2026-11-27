-- CreateTable
CREATE TABLE "boms" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "productId" UUID NOT NULL,
    "outputQty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "labourCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "scrapPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "notes" VARCHAR(300),

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "bomId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "producedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "warehouseId" UUID NOT NULL,
    "outputWarehouseId" UUID NOT NULL,
    "plannedDate" DATE NOT NULL,
    "completedDate" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "labourCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "materialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lotNo" VARCHAR(60),
    "expiryDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_lines" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "consumedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lotId" UUID,

    CONSTRAINT "work_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boms_companyId_productId_idx" ON "boms"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "boms_companyId_code_key" ON "boms"("companyId", "code");

-- CreateIndex
CREATE INDEX "work_orders_companyId_status_idx" ON "work_orders"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_companyId_number_key" ON "work_orders"("companyId", "number");

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

