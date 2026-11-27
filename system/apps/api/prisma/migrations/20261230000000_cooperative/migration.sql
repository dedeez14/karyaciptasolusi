-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "coop_members" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'INDIVIDUAL',
    "idNumber" VARCHAR(255),
    "phone" VARCHAR(30),
    "address" VARCHAR(300),
    "employeeId" UUID,
    "customerId" UUID,
    "joinDate" DATE NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    "leftDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "coop_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_saving_products" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ratePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "termMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coop_saving_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_saving_accounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "memberId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openedAt" DATE NOT NULL,
    "maturityDate" DATE,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "coop_saving_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_saving_txns" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2) NOT NULL,
    "reference" VARCHAR(100),
    "sourceId" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "coop_saving_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_interest_runs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "interest" DECIMAL(18,2) NOT NULL,
    "tax" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "coop_interest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_loan_products" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "ratePct" DECIMAL(6,3) NOT NULL,
    "method" VARCHAR(8) NOT NULL DEFAULT 'FLAT',
    "adminPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "savingPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "latePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "maxTerm" INTEGER NOT NULL DEFAULT 36,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coop_loan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_loans" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "memberId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "applicationDate" DATE NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "ratePct" DECIMAL(6,3) NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "firstDue" DATE NOT NULL,
    "adminFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "savingDeduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purpose" VARCHAR(200),
    "collateral" VARCHAR(300),
    "guarantor" VARCHAR(150),
    "status" VARCHAR(12) NOT NULL DEFAULT 'APPLIED',
    "disbursedAt" DATE,
    "bankAccountId" UUID,
    "outstanding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "coop_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_loan_installments" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "interest" DECIMAL(18,2) NOT NULL,
    "paidPrincipal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidInterest" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAt" DATE,

    CONSTRAINT "coop_loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_loan_payments" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "interest" DECIMAL(18,2) NOT NULL,
    "lateFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bankAccountId" UUID NOT NULL,
    "allocation" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "coop_loan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_provisions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "required" DECIMAL(18,2) NOT NULL,
    "previous" DECIMAL(18,2) NOT NULL,
    "delta" DECIMAL(18,2) NOT NULL,
    "detail" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coop_provisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_shu_runs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "shu" DECIMAL(18,2) NOT NULL,
    "split" JSONB NOT NULL,
    "reserve" DECIMAL(18,2) NOT NULL,
    "capitalPart" DECIMAL(18,2) NOT NULL,
    "txnPart" DECIMAL(18,2) NOT NULL,
    "funds" DECIMAL(18,2) NOT NULL,
    "payout" VARCHAR(8) NOT NULL DEFAULT 'PAYABLE',
    "ratNotes" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "coop_shu_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_shu_members" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "capitalBase" DECIMAL(18,2) NOT NULL,
    "txnBase" DECIMAL(18,2) NOT NULL,
    "capitalShu" DECIMAL(18,2) NOT NULL,
    "txnShu" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "coop_shu_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coop_members_companyId_number_key" ON "coop_members"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "coop_saving_products_companyId_code_key" ON "coop_saving_products"("companyId", "code");

-- CreateIndex
CREATE INDEX "coop_saving_accounts_memberId_idx" ON "coop_saving_accounts"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "coop_saving_accounts_companyId_number_key" ON "coop_saving_accounts"("companyId", "number");

-- CreateIndex
CREATE INDEX "coop_saving_txns_accountId_date_idx" ON "coop_saving_txns"("accountId", "date");

-- CreateIndex
CREATE INDEX "coop_saving_txns_sourceId_idx" ON "coop_saving_txns"("sourceId");

-- CreateIndex
CREATE INDEX "coop_interest_runs_companyId_period_idx" ON "coop_interest_runs"("companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "coop_loan_products_companyId_code_key" ON "coop_loan_products"("companyId", "code");

-- CreateIndex
CREATE INDEX "coop_loans_memberId_idx" ON "coop_loans"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "coop_loans_companyId_number_key" ON "coop_loans"("companyId", "number");

-- CreateIndex
CREATE INDEX "coop_loan_installments_loanId_idx" ON "coop_loan_installments"("loanId");

-- CreateIndex
CREATE INDEX "coop_loan_payments_loanId_idx" ON "coop_loan_payments"("loanId");

-- CreateIndex
CREATE INDEX "coop_provisions_companyId_date_idx" ON "coop_provisions"("companyId", "date");

-- CreateIndex
CREATE INDEX "coop_shu_runs_companyId_year_idx" ON "coop_shu_runs"("companyId", "year");

-- CreateIndex
CREATE INDEX "coop_shu_members_runId_idx" ON "coop_shu_members"("runId");

-- AddForeignKey
ALTER TABLE "coop_saving_txns" ADD CONSTRAINT "coop_saving_txns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "coop_saving_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coop_loan_installments" ADD CONSTRAINT "coop_loan_installments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "coop_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coop_loan_payments" ADD CONSTRAINT "coop_loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "coop_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coop_shu_members" ADD CONSTRAINT "coop_shu_members_runId_fkey" FOREIGN KEY ("runId") REFERENCES "coop_shu_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

