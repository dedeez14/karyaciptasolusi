-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "cashFlowCode" VARCHAR(20);

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bpjsJht" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bpjsJp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bpjsKes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bpjsKesNo" VARCHAR(30),
ADD COLUMN     "bpjsTkNo" VARCHAR(30),
ADD COLUMN     "ptkpCode" VARCHAR(10),
ADD COLUMN     "taxMethod" VARCHAR(10) NOT NULL DEFAULT 'GROSS';

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "taxGroupCode" VARCHAR(20);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentText" VARCHAR(500);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "whtAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "whtBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "whtRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
ADD COLUMN     "whtSlipDate" DATE,
ADD COLUMN     "whtSlipNo" VARCHAR(60),
ADD COLUMN     "whtTaxId" UUID;

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "totalEmployerCost" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payslips" ADD COLUMN     "employerCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "statutory" JSONB;

-- AlterTable
ALTER TABLE "salary_components" ADD COLUMN     "fixedAllowance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "taxes" ADD COLUMN     "baseDenominator" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "baseNumerator" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'VAT',
ADD COLUMN     "noNpwpSurcharge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "objectCode" VARCHAR(20),
ADD COLUMN     "trxCode" VARCHAR(4);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "typeCode" VARCHAR(30) NOT NULL,
    "requesterName" VARCHAR(150) NOT NULL,
    "requesterEmail" VARCHAR(150),
    "subjectType" VARCHAR(20) NOT NULL,
    "subjectId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "details" TEXT,
    "response" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_breaches" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "notifyBy" TIMESTAMP(3) NOT NULL,
    "dataCategories" TEXT,
    "subjectsAffected" INTEGER,
    "cause" TEXT,
    "actionsTaken" TEXT,
    "severityCode" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "subjectsNotifiedAt" TIMESTAMP(3),
    "authorityNotifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "data_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_companyId_number_key" ON "data_subject_requests"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "data_breaches_companyId_number_key" ON "data_breaches"("companyId", "number");

