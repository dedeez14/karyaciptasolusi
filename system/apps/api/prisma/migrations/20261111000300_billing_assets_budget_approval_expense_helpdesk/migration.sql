-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "customerId" UUID NOT NULL,
    "projectId" UUID,
    "intervalCode" VARCHAR(20) NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "nextRunDate" DATE NOT NULL,
    "paymentTermId" UUID,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "autoConfirm" BOOLEAN NOT NULL DEFAULT true,
    "autoEmail" BOOLEAN NOT NULL DEFAULT false,
    "emailTo" VARCHAR(150),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastInvoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_lines" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID,
    "description" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "uomId" UUID,
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxId" UUID,

    CONSTRAINT "subscription_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_reminders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "sentTo" VARCHAR(150) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "categoryCode" VARCHAR(50),
    "serialNumber" VARCHAR(100),
    "location" VARCHAR(150),
    "custodianEmployeeId" UUID,
    "supplierId" UUID,
    "acquisitionDate" DATE NOT NULL,
    "depreciationStartDate" DATE NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "salvageValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "methodCode" VARCHAR(30) NOT NULL DEFAULT 'STRAIGHT_LINE',
    "assetAccountId" UUID,
    "accumDepAccountId" UUID,
    "depExpenseAccountId" UUID,
    "accumulatedDepreciation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastDepreciationPeriod" VARCHAR(7),
    "statusCode" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "disposalDate" DATE,
    "disposalAmount" DECIMAL(18,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciations" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "bookValueAfter" DECIMAL(18,2) NOT NULL,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "year" INTEGER NOT NULL,
    "statusCode" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "costCenterId" UUID,
    "projectId" UUID,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "docType" VARCHAR(20) NOT NULL,
    "minAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "approverRoleId" UUID,
    "approverUserId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "ruleId" UUID,
    "docType" VARCHAR(20) NOT NULL,
    "documentId" UUID NOT NULL,
    "documentNumber" VARCHAR(60) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approverRoleId" UUID,
    "approverUserId" UUID,
    "requestedById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" VARCHAR(40) NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBankAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim_lines" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "categoryCode" VARCHAR(50),
    "accountId" UUID,
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "projectId" UUID,
    "costCenterId" UUID,

    CONSTRAINT "expense_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "subject" VARCHAR(250) NOT NULL,
    "description" TEXT,
    "customerId" UUID,
    "contactName" VARCHAR(150),
    "contactEmail" VARCHAR(150),
    "contactPhone" VARCHAR(50),
    "projectId" UUID,
    "categoryCode" VARCHAR(50),
    "priorityCode" VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
    "statusCode" VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    "channelCode" VARCHAR(50),
    "assigneeId" UUID,
    "dueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "satisfaction" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "userId" UUID,
    "authorName" VARCHAR(150),
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_companyId_nextRunDate_idx" ON "subscriptions"("companyId", "nextRunDate");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_companyId_code_key" ON "subscriptions"("companyId", "code");

-- CreateIndex
CREATE INDEX "subscription_lines_subscriptionId_idx" ON "subscription_lines"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_reminders_documentId_level_key" ON "invoice_reminders"("documentId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_companyId_code_key" ON "fixed_assets"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_assetId_period_key" ON "asset_depreciations"("assetId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_companyId_code_key" ON "budgets"("companyId", "code");

-- CreateIndex
CREATE INDEX "budget_lines_budgetId_idx" ON "budget_lines"("budgetId");

-- CreateIndex
CREATE INDEX "approval_rules_companyId_docType_idx" ON "approval_rules"("companyId", "docType");

-- CreateIndex
CREATE INDEX "approval_requests_companyId_statusCode_idx" ON "approval_requests"("companyId", "statusCode");

-- CreateIndex
CREATE INDEX "approval_requests_documentId_idx" ON "approval_requests"("documentId");

-- CreateIndex
CREATE INDEX "expense_claims_companyId_statusCode_idx" ON "expense_claims"("companyId", "statusCode");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_companyId_number_key" ON "expense_claims"("companyId", "number");

-- CreateIndex
CREATE INDEX "expense_claim_lines_claimId_idx" ON "expense_claim_lines"("claimId");

-- CreateIndex
CREATE INDEX "tickets_companyId_statusCode_idx" ON "tickets"("companyId", "statusCode");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_idx" ON "tickets"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_companyId_code_key" ON "tickets"("companyId", "code");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_idx" ON "ticket_messages"("ticketId");

-- AddForeignKey
ALTER TABLE "subscription_lines" ADD CONSTRAINT "subscription_lines_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

