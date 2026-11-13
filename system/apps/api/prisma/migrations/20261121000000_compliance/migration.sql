-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "directLabour" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nationality" VARCHAR(3) NOT NULL DEFAULT 'ID';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "auxiliaryMaterial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bpomRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "halalRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hsCode" VARCHAR(12),
ADD COLUMN     "originCountry" VARCHAR(3),
ADD COLUMN     "sniRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "compliance_certificates" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "number" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "issuer" VARCHAR(150),
    "holder" VARCHAR(10) NOT NULL DEFAULT 'OWN',
    "supplierId" UUID,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "tkdnValue" DECIMAL(6,2),
    "bmpValue" DECIMAL(6,2),
    "scope" TEXT,
    "reviewNeeded" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "compliance_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_certificate_products" (
    "certificateId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "compliance_certificate_products_pkey" PRIMARY KEY ("certificateId","productId")
);

-- CreateTable
CREATE TABLE "tkdn_assessments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "productId" UUID NOT NULL,
    "bomId" UUID,
    "date" DATE NOT NULL,
    "productType" VARCHAR(150),
    "specification" VARCHAR(300),
    "standard" VARCHAR(100),
    "productionMode" VARCHAR(15) NOT NULL DEFAULT 'OWN',
    "investedInIndonesia" BOOLEAN NOT NULL DEFAULT true,
    "directLabourTotal" INTEGER NOT NULL DEFAULT 0,
    "directLabourWni" INTEGER NOT NULL DEFAULT 0,
    "bwInvestment" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "bwUnit" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "bwProgram" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "bwImplementation" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "materialFactor" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "labourFactor" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "overheadFactor" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "brainware" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "tkdn" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(8) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tkdn_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tkdn_assessment_lines" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "productId" UUID,
    "description" VARCHAR(200) NOT NULL,
    "specification" VARCHAR(200),
    "uom" VARCHAR(20),
    "originCountry" VARCHAR(3) NOT NULL DEFAULT 'ID',
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "hasCertificate" BOOLEAN NOT NULL DEFAULT false,
    "certTkdn" DECIMAL(6,2),
    "domesticProducer" BOOLEAN NOT NULL DEFAULT false,
    "allDomesticMaterials" BOOLEAN NOT NULL DEFAULT false,
    "creditPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "share" DECIMAL(9,4) NOT NULL DEFAULT 0,

    CONSTRAINT "tkdn_assessment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_types" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" INTEGER NOT NULL DEFAULT 2,
    "sourceType" VARCHAR(20) NOT NULL DEFAULT 'NON_SPECIFIC',
    "characteristics" VARCHAR(200),
    "atLeast50KgPerDay" BOOLEAN NOT NULL DEFAULT false,
    "storageLocation" VARCHAR(150),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "waste_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "wasteTypeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source" VARCHAR(200),
    "qty" DECIMAL(18,3) NOT NULL,
    "remainingQty" DECIMAL(18,3) NOT NULL,
    "storageDays" INTEGER NOT NULL,
    "maxStorageDate" DATE NOT NULL,
    "notes" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "waste_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_handovers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "treatment" VARCHAR(12) NOT NULL,
    "transporterId" UUID,
    "receiverId" UUID,
    "manifestNo" VARCHAR(60),
    "vehicleNo" VARCHAR(30),
    "licenceNo" VARCHAR(100),
    "notes" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "waste_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_handover_lines" (
    "id" UUID NOT NULL,
    "handoverId" UUID NOT NULL,
    "wasteTypeId" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "allocations" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "waste_handover_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siinas_reports" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "receiptNo" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "siinas_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_certificates_companyId_type_idx" ON "compliance_certificates"("companyId", "type");

-- CreateIndex
CREATE INDEX "compliance_certificate_products_productId_idx" ON "compliance_certificate_products"("productId");

-- CreateIndex
CREATE INDEX "tkdn_assessments_companyId_productId_idx" ON "tkdn_assessments"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "tkdn_assessments_companyId_number_key" ON "tkdn_assessments"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "waste_types_companyId_code_key" ON "waste_types"("companyId", "code");

-- CreateIndex
CREATE INDEX "waste_entries_companyId_wasteTypeId_date_idx" ON "waste_entries"("companyId", "wasteTypeId", "date");

-- CreateIndex
CREATE INDEX "waste_handovers_companyId_date_idx" ON "waste_handovers"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "waste_handovers_companyId_number_key" ON "waste_handovers"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "siinas_reports_companyId_year_quarter_key" ON "siinas_reports"("companyId", "year", "quarter");

-- AddForeignKey
ALTER TABLE "compliance_certificate_products" ADD CONSTRAINT "compliance_certificate_products_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "compliance_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tkdn_assessment_lines" ADD CONSTRAINT "tkdn_assessment_lines_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "tkdn_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_handover_lines" ADD CONSTRAINT "waste_handover_lines_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "waste_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

