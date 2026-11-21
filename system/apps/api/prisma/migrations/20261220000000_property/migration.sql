-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "property_sites" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'HOUSE',
    "address" VARCHAR(300),
    "estimatedCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "property_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_units" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "unitType" VARCHAR(60),
    "landArea" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "buildingArea" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL,
    "ppnMode" VARCHAR(10) NOT NULL DEFAULT 'STANDARD',
    "pphRate" DECIMAL(5,2) NOT NULL DEFAULT 2.5,
    "readyToOccupy" BOOLEAN NOT NULL DEFAULT false,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "certificateNo" VARCHAR(60),
    "status" VARCHAR(10) NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,

    CONSTRAINT "property_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_sales" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "unitId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "scheme" VARCHAR(10) NOT NULL,
    "ppnMode" VARCHAR(10) NOT NULL,
    "dtpBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pphRate" DECIMAL(5,2) NOT NULL,
    "kprBank" VARCHAR(100),
    "ppjbNo" VARCHAR(60),
    "ppjbDate" DATE,
    "ajbNo" VARCHAR(60),
    "ajbDate" DATE,
    "notary" VARCHAR(150),
    "handoverDate" DATE,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" VARCHAR(10),
    "forfeit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refund" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refundDue" DATE,
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "property_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_sale_lines" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "invoiceId" UUID,

    CONSTRAINT "property_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_tax_payments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "property_tax_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_sites_companyId_code_key" ON "property_sites"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "property_units_siteId_code_key" ON "property_units"("siteId", "code");

-- CreateIndex
CREATE INDEX "property_sales_unitId_idx" ON "property_sales"("unitId");

-- CreateIndex
CREATE INDEX "property_sales_companyId_status_idx" ON "property_sales"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "property_sales_companyId_number_key" ON "property_sales"("companyId", "number");

-- CreateIndex
CREATE INDEX "property_sale_lines_saleId_idx" ON "property_sale_lines"("saleId");

-- CreateIndex
CREATE INDEX "property_sale_lines_invoiceId_idx" ON "property_sale_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "property_tax_payments_companyId_period_idx" ON "property_tax_payments"("companyId", "period");

-- AddForeignKey
ALTER TABLE "property_units" ADD CONSTRAINT "property_units_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "property_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_sale_lines" ADD CONSTRAINT "property_sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "property_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

