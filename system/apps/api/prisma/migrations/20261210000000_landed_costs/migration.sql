-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "landed_costs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "supplierId" UUID,
    "reference" VARCHAR(100),
    "pibNo" VARCHAR(20),
    "pibDate" DATE,
    "incoterm" VARCHAR(3) NOT NULL DEFAULT 'CIF',
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "ndpbm" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "freightFx" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "insuranceFx" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "apiHolder" BOOLEAN NOT NULL DEFAULT true,
    "ppnCreditable" BOOLEAN NOT NULL DEFAULT true,
    "bmActual" DECIMAL(18,2),
    "ppnActual" DECIMAL(18,2),
    "pph22Actual" DECIMAL(18,2),
    "customsValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bmad" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppnbm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph22" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "charges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "toInventory" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "toCogs" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "landed_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_lines" (
    "id" UUID NOT NULL,
    "landedCostId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "receiptLineId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "valueFx" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "weight" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "hsCode" VARCHAR(12),
    "bmPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "bmadPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "ppnbmPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "pph22Pct" DECIMAL(9,4),
    "customsValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bmad" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppnbm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph22" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "charges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "qtyOnHand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "toInventory" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "toCogs" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "landed_cost_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_charges" (
    "id" UUID NOT NULL,
    "landedCostId" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "description" VARCHAR(200),
    "amount" DECIMAL(18,2) NOT NULL,
    "method" VARCHAR(6) NOT NULL DEFAULT 'VALUE',
    "sourceDocId" UUID,
    "sourceLineId" UUID,

    CONSTRAINT "landed_cost_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "landed_costs_companyId_date_idx" ON "landed_costs"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "landed_costs_companyId_number_key" ON "landed_costs"("companyId", "number");

-- CreateIndex
CREATE INDEX "landed_cost_lines_landedCostId_idx" ON "landed_cost_lines"("landedCostId");

-- CreateIndex
CREATE INDEX "landed_cost_lines_receiptLineId_idx" ON "landed_cost_lines"("receiptLineId");

-- CreateIndex
CREATE INDEX "landed_cost_charges_landedCostId_idx" ON "landed_cost_charges"("landedCostId");

-- CreateIndex
CREATE INDEX "landed_cost_charges_sourceLineId_idx" ON "landed_cost_charges"("sourceLineId");

-- AddForeignKey
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "landed_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "landed_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

