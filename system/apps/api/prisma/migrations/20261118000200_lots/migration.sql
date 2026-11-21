-- AlterTable
ALTER TABLE "products" ADD COLUMN     "expiryAlertDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "shelfLifeDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trackLots" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "trade_document_lines" ADD COLUMN     "expiryDate" DATE,
ADD COLUMN     "lotId" UUID,
ADD COLUMN     "lotNo" VARCHAR(60);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lotNo" VARCHAR(60) NOT NULL,
    "expiryDate" DATE,
    "manufactureDate" DATE,
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_balances" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_lots" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_disposals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "warehouseId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reasonCode" VARCHAR(20) NOT NULL,
    "method" VARCHAR(200),
    "witnessedBy" VARCHAR(300),
    "externalWitness" VARCHAR(300),
    "notes" TEXT,
    "adjustmentId" UUID,
    "lines" JSONB NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "stock_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_companyId_expiryDate_idx" ON "stock_lots"("companyId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_companyId_productId_lotNo_key" ON "stock_lots"("companyId", "productId", "lotNo");

-- CreateIndex
CREATE UNIQUE INDEX "lot_balances_lotId_warehouseId_key" ON "lot_balances"("lotId", "warehouseId");

-- CreateIndex
CREATE INDEX "line_lots_documentId_idx" ON "line_lots"("documentId");

-- CreateIndex
CREATE INDEX "line_lots_lotId_idx" ON "line_lots"("lotId");

-- CreateIndex
CREATE INDEX "line_lots_lineId_idx" ON "line_lots"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_disposals_companyId_number_key" ON "stock_disposals"("companyId", "number");

-- AddForeignKey
ALTER TABLE "lot_balances" ADD CONSTRAINT "lot_balances_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

