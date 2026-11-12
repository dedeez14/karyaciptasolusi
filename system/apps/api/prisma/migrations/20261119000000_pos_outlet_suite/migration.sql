-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "boms" ADD COLUMN     "backflushOnSale" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "memberNo" VARCHAR(30),
ADD COLUMN     "memberSince" TIMESTAMP(3),
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pos_sale_lines" ADD COLUMN     "course" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "modifiers" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "note" VARCHAR(200),
ADD COLUMN     "promoDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "station" VARCHAR(30),
ADD COLUMN     "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "ticketId" UUID,
ADD COLUMN     "voidReason" VARCHAR(200);

-- AlterTable
ALTER TABLE "pos_sales" ADD COLUMN     "billPrintedAt" TIMESTAMP(3),
ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "covers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kitchenStatus" VARCHAR(10) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "label" VARCHAR(60),
ADD COLUMN     "orderType" VARCHAR(10) NOT NULL DEFAULT 'RETAIL',
ADD COLUMN     "outletId" UUID,
ADD COLUMN     "pointsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsRedeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "queueNo" VARCHAR(12),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "serviceCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tableId" UUID,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "voucherCode" VARCHAR(40),
ALTER COLUMN "number" DROP NOT NULL,
ALTER COLUMN "payments" SET DEFAULT '[]';

-- AlterTable
ALTER TABLE "pos_sessions" ADD COLUMN     "outletId" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "posStation" VARCHAR(30);

-- CreateTable
CREATE TABLE "pos_outlets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "warehouseId" UUID NOT NULL,
    "mode" VARCHAR(10) NOT NULL DEFAULT 'RETAIL',
    "serviceStyle" VARCHAR(10) NOT NULL DEFAULT 'COUNTER',
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
    "pbjtRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "serviceChargePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "serviceChargeToStaff" BOOLEAN NOT NULL DEFAULT false,
    "priceListId" UUID,
    "qrisAccountId" UUID,
    "cardAccountId" UUID,
    "transferAccountId" UUID,
    "queuePrefix" VARCHAR(5) NOT NULL DEFAULT 'A',
    "queueDate" DATE,
    "queueNext" INTEGER NOT NULL DEFAULT 1,
    "receiptFooter" VARCHAR(300),
    "displayMessage" VARCHAR(300),
    "readyAnnouncement" VARCHAR(200) NOT NULL DEFAULT 'Order {number} is ready',
    "kdsWarnMinutes" INTEGER NOT NULL DEFAULT 10,
    "kdsLateMinutes" INTEGER NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pos_outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_tables" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "area" VARCHAR(60),
    "seats" INTEGER NOT NULL DEFAULT 4,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pos_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_kitchen_tickets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "station" VARCHAR(30) NOT NULL,
    "course" INTEGER NOT NULL DEFAULT 1,
    "label" VARCHAR(60) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),

    CONSTRAINT "pos_kitchen_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_modifier_groups" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_modifier_options" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productId" UUID,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pos_modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_product_modifiers" (
    "productId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pos_product_modifiers_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_promotions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "buyQty" INTEGER NOT NULL DEFAULT 0,
    "getQty" INTEGER NOT NULL DEFAULT 0,
    "minSpend" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "maxDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productIds" UUID[],
    "categoryIds" UUID[],
    "outletIds" UUID[],
    "membersOnly" BOOLEAN NOT NULL DEFAULT false,
    "voucherCode" VARCHAR(40),
    "startDate" DATE,
    "endDate" DATE,
    "days" INTEGER[],
    "timeFrom" VARCHAR(5),
    "timeTo" VARCHAR(5),
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pos_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_point_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "saleId" UUID,
    "points" INTEGER NOT NULL,
    "reason" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "pos_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_outlets_companyId_code_key" ON "pos_outlets"("companyId", "code");

-- CreateIndex
CREATE INDEX "pos_tables_outletId_idx" ON "pos_tables"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_tables_companyId_code_key" ON "pos_tables"("companyId", "code");

-- CreateIndex
CREATE INDEX "pos_kitchen_tickets_outletId_status_idx" ON "pos_kitchen_tickets"("outletId", "status");

-- CreateIndex
CREATE INDEX "pos_modifier_groups_companyId_idx" ON "pos_modifier_groups"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_companyId_code_key" ON "price_lists"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_priceListId_productId_key" ON "price_list_items"("priceListId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_promotions_companyId_code_key" ON "pos_promotions"("companyId", "code");

-- CreateIndex
CREATE INDEX "pos_point_entries_companyId_customerId_idx" ON "pos_point_entries"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_memberNo_key" ON "customers"("companyId", "memberNo");

-- CreateIndex
CREATE INDEX "pos_sale_lines_saleId_idx" ON "pos_sale_lines"("saleId");

-- CreateIndex
CREATE INDEX "pos_sales_outletId_status_idx" ON "pos_sales"("outletId", "status");

-- AddForeignKey
ALTER TABLE "pos_sale_lines" ADD CONSTRAINT "pos_sale_lines_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "pos_kitchen_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_kitchen_tickets" ADD CONSTRAINT "pos_kitchen_tickets_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_modifier_options" ADD CONSTRAINT "pos_modifier_options_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "pos_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_product_modifiers" ADD CONSTRAINT "pos_product_modifiers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "pos_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: one default outlet per company (first warehouse), taking over the earlier company-wide POS settings
INSERT INTO "pos_outlets" ("id", "companyId", "code", "name", "warehouseId", "mode", "serviceStyle", "pricesIncludeTax", "pbjtRate", "receiptFooter", "updatedAt")
SELECT gen_random_uuid(), c."id", 'MAIN', 'Main Outlet', w."id",
       COALESCE((SELECT s."value" FROM "settings" s WHERE s."key" = 'pos.mode' AND (s."companyId" = c."id" OR s."companyId" IS NULL) ORDER BY s."companyId" NULLS LAST LIMIT 1), 'RETAIL'),
       'COUNTER',
       COALESCE((SELECT s."value" FROM "settings" s WHERE s."key" = 'pos.pricesIncludeTax' AND (s."companyId" = c."id" OR s."companyId" IS NULL) ORDER BY s."companyId" NULLS LAST LIMIT 1), 'true') = 'true',
       COALESCE(NULLIF((SELECT s."value" FROM "settings" s WHERE s."key" = 'pos.pbjtRate' AND (s."companyId" = c."id" OR s."companyId" IS NULL) ORDER BY s."companyId" NULLS LAST LIMIT 1), '')::numeric, 0),
       (SELECT s."value" FROM "settings" s WHERE s."key" = 'pos.receiptFooter' AND (s."companyId" = c."id" OR s."companyId" IS NULL) ORDER BY s."companyId" NULLS LAST LIMIT 1),
       now()
FROM "companies" c
JOIN LATERAL (SELECT "id" FROM "warehouses" WHERE "companyId" = c."id" AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1) w ON true;

UPDATE "pos_sessions" ps SET "outletId" = o."id" FROM "pos_outlets" o WHERE o."companyId" = ps."companyId" AND o."code" = 'MAIN' AND ps."outletId" IS NULL;
UPDATE "pos_sales" s SET "outletId" = ps."outletId" FROM "pos_sessions" ps WHERE ps."id" = s."sessionId" AND s."outletId" IS NULL;

-- settings now kept per outlet
DELETE FROM "settings" WHERE "key" IN ('pos.mode', 'pos.pricesIncludeTax', 'pos.pbjtRate', 'pos.qrisAccountId', 'pos.cardAccountId', 'pos.transferAccountId', 'pos.receiptFooter');
