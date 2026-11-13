-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "customsClass" VARCHAR(8);

-- CreateTable
CREATE TABLE "customs_documents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "bcType" VARCHAR(6) NOT NULL,
    "direction" VARCHAR(3) NOT NULL,
    "facility" VARCHAR(5) NOT NULL DEFAULT 'KB',
    "destination" VARCHAR(6),
    "ajuNo" VARCHAR(30),
    "registrationNo" VARCHAR(20),
    "registrationDate" DATE,
    "officeCode" VARCHAR(8),
    "tradeDocumentId" UUID,
    "receiptNumber" VARCHAR(40),
    "receiptDate" DATE,
    "supplierId" UUID,
    "customerId" UUID,
    "partnerName" VARCHAR(200),
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalValueIdr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dutyBasis" VARCHAR(4),
    "bm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppnbm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph22" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fine" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dutyStatus" VARCHAR(10) NOT NULL DEFAULT 'SUSPENDED',
    "ppnCreditable" BOOLEAN NOT NULL DEFAULT true,
    "returnDueDate" DATE,
    "linkedId" UUID,
    "kiteDueDate" DATE,
    "taxInvoiceCode" VARCHAR(2),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "customs_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customs_document_lines" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "hsCode" VARCHAR(12),
    "description" VARCHAR(200),
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20),
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "valueIdr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "originCountry" VARCHAR(3),
    "wastePct" DECIMAL(9,4),
    "settledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "customs_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customs_allocations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" VARCHAR(6) NOT NULL,
    "sourceLineId" UUID NOT NULL,
    "targetDocId" UUID NOT NULL,
    "targetLineId" UUID,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customs_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customs_documents_companyId_bcType_registrationDate_idx" ON "customs_documents"("companyId", "bcType", "registrationDate");

-- CreateIndex
CREATE INDEX "customs_documents_tradeDocumentId_idx" ON "customs_documents"("tradeDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "customs_documents_companyId_number_key" ON "customs_documents"("companyId", "number");

-- CreateIndex
CREATE INDEX "customs_document_lines_documentId_idx" ON "customs_document_lines"("documentId");

-- CreateIndex
CREATE INDEX "customs_document_lines_productId_idx" ON "customs_document_lines"("productId");

-- CreateIndex
CREATE INDEX "customs_allocations_sourceLineId_idx" ON "customs_allocations"("sourceLineId");

-- CreateIndex
CREATE INDEX "customs_allocations_targetDocId_idx" ON "customs_allocations"("targetDocId");

-- AddForeignKey
ALTER TABLE "customs_document_lines" ADD CONSTRAINT "customs_document_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "customs_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

