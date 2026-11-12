-- AlterTable
ALTER TABLE "products" ADD COLUMN     "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxStock" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "preferredSupplierId" UUID,
ADD COLUMN     "reorderQty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "warehouseId" UUID NOT NULL,
    "countDate" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'COUNTING',
    "countedBy" VARCHAR(200),
    "witnessedBy" VARCHAR(200),
    "notes" TEXT,
    "adjustmentId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "systemQty" DECIMAL(18,4) NOT NULL,
    "countedQty" DECIMAL(18,4),
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(300),
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_companyId_number_key" ON "stock_counts"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_countId_productId_key" ON "stock_count_lines"("countId", "productId");

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

