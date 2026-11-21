-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "marketplace_stores" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "channel" VARCHAR(12) NOT NULL,
    "kind" VARCHAR(6) NOT NULL DEFAULT 'STORE',
    "url" VARCHAR(300),
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "customerId" UUID,
    "balanceBankAccountId" UUID,
    "payoutBankAccountId" UUID,
    "taxId" UUID,
    "whtTaxId" UUID,
    "defaultProductId" UUID,
    "apiToken" TEXT,
    "syncFrom" DATE,
    "lastSyncAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "marketplace_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "externalId" VARCHAR(80) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "url" VARCHAR(500),
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "productId" UUID,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "externalId" VARCHAR(80) NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxCollected" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refunded" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeRefunded" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(8) NOT NULL DEFAULT 'PAID',
    "country" VARCHAR(2),
    "source" VARCHAR(6) NOT NULL DEFAULT 'FILE',
    "settlementId" UUID,
    "refundBooked" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeRefundBooked" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "importId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "listingId" UUID,
    "externalId" VARCHAR(80),
    "title" VARCHAR(300) NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "marketplace_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_settlements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fees" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withheld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refunds" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoiceId" UUID,
    "receiptId" UUID,
    "status" VARCHAR(9) NOT NULL DEFAULT 'POSTED',
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "marketplace_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_payouts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "externalId" VARCHAR(80),
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "amountBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bankAccountId" UUID,
    "reference" VARCHAR(100),
    "status" VARCHAR(9) NOT NULL DEFAULT 'PENDING',
    "source" VARCHAR(6) NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "marketplace_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_stats" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "rangeLabel" VARCHAR(100),
    "visits" INTEGER,
    "views" INTEGER,
    "orders" INTEGER,
    "revenue" DECIMAL(18,2),
    "followers" INTEGER,
    "favorites" INTEGER,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "saves" INTEGER,
    "listings" INTEGER,
    "source" VARCHAR(6) NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_imports" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "source" VARCHAR(6) NOT NULL,
    "fileName" VARCHAR(200),
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "marketplace_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_stores_companyId_code_key" ON "marketplace_stores"("companyId", "code");

-- CreateIndex
CREATE INDEX "marketplace_listings_companyId_idx" ON "marketplace_listings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_storeId_externalId_key" ON "marketplace_listings"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "marketplace_orders_companyId_orderDate_idx" ON "marketplace_orders"("companyId", "orderDate");

-- CreateIndex
CREATE INDEX "marketplace_orders_settlementId_idx" ON "marketplace_orders"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_storeId_externalId_key" ON "marketplace_orders"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "marketplace_order_lines_orderId_idx" ON "marketplace_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "marketplace_order_lines_listingId_idx" ON "marketplace_order_lines"("listingId");

-- CreateIndex
CREATE INDEX "marketplace_settlements_storeId_idx" ON "marketplace_settlements"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_settlements_companyId_number_key" ON "marketplace_settlements"("companyId", "number");

-- CreateIndex
CREATE INDEX "marketplace_payouts_companyId_date_idx" ON "marketplace_payouts"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_payouts_storeId_externalId_key" ON "marketplace_payouts"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "marketplace_stats_companyId_date_idx" ON "marketplace_stats"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_stats_storeId_date_key" ON "marketplace_stats"("storeId", "date");

-- CreateIndex
CREATE INDEX "marketplace_imports_storeId_createdAt_idx" ON "marketplace_imports"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "marketplace_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "marketplace_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_lines" ADD CONSTRAINT "marketplace_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_lines" ADD CONSTRAINT "marketplace_order_lines_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "marketplace_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_settlements" ADD CONSTRAINT "marketplace_settlements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "marketplace_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_payouts" ADD CONSTRAINT "marketplace_payouts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "marketplace_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_stats" ADD CONSTRAINT "marketplace_stats_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "marketplace_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

