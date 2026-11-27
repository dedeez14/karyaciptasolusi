-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "channel" VARCHAR(20),
ADD COLUMN     "creditHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "priceListId" UUID;

-- CreateTable
CREATE TABLE "sales_routes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "salesmanId" UUID NOT NULL,
    "vanWarehouseId" UUID,
    "cashAccountId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "days" JSONB NOT NULL,
    "weeks" VARCHAR(5) NOT NULL DEFAULT 'EVERY',

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_visits" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "routeId" UUID,
    "customerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "distanceM" INTEGER,
    "outcome" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(200),
    "orderId" UUID,
    "invoiceId" UUID,
    "deliveryId" UUID,
    "paymentId" UUID,
    "sales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "collected" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "van_settlements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "routeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "sales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "collections" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stock" JSONB NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "productive" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(6) NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "van_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_routes_companyId_code_key" ON "sales_routes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeId_customerId_key" ON "route_stops"("routeId", "customerId");

-- CreateIndex
CREATE INDEX "sales_visits_companyId_date_idx" ON "sales_visits"("companyId", "date");

-- CreateIndex
CREATE INDEX "sales_visits_companyId_customerId_idx" ON "sales_visits"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "van_settlements_companyId_number_key" ON "van_settlements"("companyId", "number");

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "sales_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

