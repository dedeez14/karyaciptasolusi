-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "garment_styles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "customerId" UUID,
    "season" VARCHAR(40),
    "category" VARCHAR(60),
    "sizes" JSONB NOT NULL,
    "colours" JSONB NOT NULL,
    "composition" VARCHAR(150),
    "care" VARCHAR(200),
    "sam" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "garment_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_variants" (
    "id" UUID NOT NULL,
    "styleId" UUID NOT NULL,
    "colour" VARCHAR(30) NOT NULL,
    "size" VARCHAR(20) NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "garment_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_operations" (
    "id" UUID NOT NULL,
    "styleId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "machine" VARCHAR(20),
    "sam" DECIMAL(8,3) NOT NULL,
    "pieceRate" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "garment_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_materials" (
    "id" UUID NOT NULL,
    "styleId" UUID NOT NULL,
    "kind" VARCHAR(6) NOT NULL,
    "productId" UUID NOT NULL,
    "qtyPerPiece" DECIMAL(12,4) NOT NULL,
    "colour" VARCHAR(30),

    CONSTRAINT "garment_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "styleId" UUID NOT NULL,
    "customerId" UUID,
    "buyerRef" VARCHAR(60),
    "orderDate" DATE NOT NULL,
    "shipDate" DATE,
    "warehouseId" UUID NOT NULL,
    "fgWarehouseId" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "cutAllowancePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fabricCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fabricRelieved" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "trimCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "conversionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closedLoss" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "salesOrderId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "garment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "colour" VARCHAR(30) NOT NULL,
    "size" VARCHAR(20) NOT NULL,
    "productId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "cutQty" INTEGER NOT NULL DEFAULT 0,
    "sewnQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "garment_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_lays" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "colour" VARCHAR(30) NOT NULL,
    "ratio" JSONB NOT NULL,
    "plies" INTEGER NOT NULL,
    "markerLengthM" DECIMAL(10,3),
    "markerEfficiency" DECIMAL(5,2),
    "fabricProductId" UUID,
    "fabricQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "fabricCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shade" VARCHAR(20),
    "bundleSize" INTEGER NOT NULL DEFAULT 20,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "garment_lays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_bundles" (
    "id" UUID NOT NULL,
    "layId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "bundleNo" INTEGER NOT NULL,
    "colour" VARCHAR(30) NOT NULL,
    "size" VARCHAR(20) NOT NULL,
    "plyFrom" INTEGER NOT NULL,
    "plyTo" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "garment_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_line_outputs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "lineId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "operators" INTEGER NOT NULL,
    "helpers" INTEGER NOT NULL DEFAULT 0,
    "minutes" DECIMAL(8,2) NOT NULL,
    "pieces" JSONB NOT NULL,
    "totalPieces" INTEGER NOT NULL,
    "rejects" INTEGER NOT NULL DEFAULT 0,
    "sam" DECIMAL(10,3) NOT NULL,
    "efficiency" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "garment_line_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_receipts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "totalPieces" INTEGER NOT NULL,
    "fabricCost" DECIMAL(18,2) NOT NULL,
    "trimCost" DECIMAL(18,2) NOT NULL,
    "conversionCost" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "garment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garment_styles_companyId_code_key" ON "garment_styles"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "garment_variants_styleId_colour_size_key" ON "garment_variants"("styleId", "colour", "size");

-- CreateIndex
CREATE INDEX "garment_operations_styleId_idx" ON "garment_operations"("styleId");

-- CreateIndex
CREATE INDEX "garment_materials_styleId_idx" ON "garment_materials"("styleId");

-- CreateIndex
CREATE INDEX "garment_orders_companyId_status_idx" ON "garment_orders"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "garment_orders_companyId_number_key" ON "garment_orders"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "garment_order_lines_orderId_colour_size_key" ON "garment_order_lines"("orderId", "colour", "size");

-- CreateIndex
CREATE INDEX "garment_lays_orderId_idx" ON "garment_lays"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "garment_lays_companyId_number_key" ON "garment_lays"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "garment_bundles_orderId_bundleNo_key" ON "garment_bundles"("orderId", "bundleNo");

-- CreateIndex
CREATE INDEX "garment_line_outputs_companyId_date_idx" ON "garment_line_outputs"("companyId", "date");

-- CreateIndex
CREATE INDEX "garment_line_outputs_orderId_idx" ON "garment_line_outputs"("orderId");

-- CreateIndex
CREATE INDEX "garment_receipts_orderId_idx" ON "garment_receipts"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "garment_receipts_companyId_number_key" ON "garment_receipts"("companyId", "number");

-- AddForeignKey
ALTER TABLE "garment_variants" ADD CONSTRAINT "garment_variants_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "garment_styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_operations" ADD CONSTRAINT "garment_operations_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "garment_styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_materials" ADD CONSTRAINT "garment_materials_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "garment_styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_order_lines" ADD CONSTRAINT "garment_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "garment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_bundles" ADD CONSTRAINT "garment_bundles_layId_fkey" FOREIGN KEY ("layId") REFERENCES "garment_lays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

