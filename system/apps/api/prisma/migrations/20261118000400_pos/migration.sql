-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "warehouseId" UUID NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" UUID,
    "openingCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "expectedCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(18,2),
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,

    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sales" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "sessionId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" UUID,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "localTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "change" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payments" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PAID',
    "voidReason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale_lines" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxId" UUID,
    "lineNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "pos_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_sessions_companyId_status_idx" ON "pos_sessions"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sessions_companyId_number_key" ON "pos_sessions"("companyId", "number");

-- CreateIndex
CREATE INDEX "pos_sales_companyId_date_idx" ON "pos_sales"("companyId", "date");

-- CreateIndex
CREATE INDEX "pos_sales_sessionId_idx" ON "pos_sales"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_companyId_number_key" ON "pos_sales"("companyId", "number");

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pos_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_lines" ADD CONSTRAINT "pos_sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

