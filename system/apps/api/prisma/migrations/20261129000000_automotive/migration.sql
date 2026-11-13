-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "luxuryGroup" VARCHAR(6);

-- AlterTable
ALTER TABLE "trade_document_lines" ADD COLUMN     "lineLuxuryTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "luxuryBasePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
ADD COLUMN     "luxuryRate" DECIMAL(9,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "trade_documents" ADD COLUMN     "luxuryTaxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "brand" VARCHAR(60) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "typeName" VARCHAR(120) NOT NULL,
    "variant" VARCHAR(80),
    "category" VARCHAR(15) NOT NULL,
    "fuel" VARCHAR(6) NOT NULL,
    "dieselEngine" BOOLEAN NOT NULL DEFAULT false,
    "lcgc" BOOLEAN NOT NULL DEFAULT false,
    "engineCc" INTEGER,
    "motorKw" DECIMAL(9,2),
    "seats" INTEGER,
    "kmPerL" DECIMAL(9,2),
    "co2" DECIMAL(9,2),
    "emissionCertNo" VARCHAR(60),
    "sutNumber" VARCHAR(60),
    "sutDate" DATE,
    "wmi" VARCHAR(3),
    "requireCheckDigit" BOOLEAN NOT NULL DEFAULT false,
    "productId" UUID,
    "luxuryGroup" VARCHAR(6),
    "tkdnPct" DECIMAL(9,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "vin" VARCHAR(17) NOT NULL,
    "engineNo" VARCHAR(30) NOT NULL,
    "colour" VARCHAR(40) NOT NULL,
    "yearMade" INTEGER NOT NULL,
    "modelYear" INTEGER,
    "productionDate" DATE,
    "inDocument" VARCHAR(40),
    "warehouseId" UUID,
    "srutNumber" VARCHAR(60),
    "srutDate" DATE,
    "customsDocNo" VARCHAR(60),
    "status" VARCHAR(10) NOT NULL DEFAULT 'IN_STOCK',
    "customerId" UUID,
    "salesOrderId" UUID,
    "invoiceId" UUID,
    "deliveryNumber" VARCHAR(40),
    "deliveredAt" DATE,
    "fakturNo" VARCHAR(60),
    "ownerName" VARCHAR(200),
    "ownerIdNo" VARCHAR(300),
    "ownerAddress" VARCHAR(300),
    "otr" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_companyId_code_key" ON "vehicle_models"("companyId", "code");

-- CreateIndex
CREATE INDEX "vehicles_companyId_modelId_status_idx" ON "vehicles"("companyId", "modelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_vin_key" ON "vehicles"("companyId", "vin");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_engineNo_key" ON "vehicles"("companyId", "engineNo");

