-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "project_rates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "hourlyRate" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wip_accruals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "asOf" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "hours" DECIMAL(12,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "status" VARCHAR(6) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "wip_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_rates_projectId_userId_key" ON "project_rates"("projectId", "userId");

-- CreateIndex
CREATE INDEX "wip_accruals_companyId_asOf_idx" ON "wip_accruals"("companyId", "asOf");

