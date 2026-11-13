-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "rental_units" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "category" VARCHAR(60),
    "serialNo" VARCHAR(60),
    "fixedAssetId" UUID,
    "meterUnit" VARCHAR(5) NOT NULL DEFAULT 'NONE',
    "meter" DECIMAL(18,1) NOT NULL DEFAULT 0,
    "rateDay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rateWeek" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rateMonth" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "meterAllowance" DECIMAL(18,1) NOT NULL DEFAULT 0,
    "excessRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(12) NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_contracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "customerId" UUID NOT NULL,
    "site" VARCHAR(300),
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "basis" VARCHAR(5) NOT NULL,
    "billing" VARCHAR(7) NOT NULL,
    "withOperator" BOOLEAN NOT NULL DEFAULT false,
    "deposit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depositHeld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(9) NOT NULL DEFAULT 'RESERVED',
    "billedTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "rental_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_lines" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL,
    "meterAllowance" DECIMAL(18,1) NOT NULL DEFAULT 0,
    "excessRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outDate" DATE,
    "outMeter" DECIMAL(18,1),
    "returnDate" DATE,
    "returnMeter" DECIMAL(18,1),
    "billedMeter" DECIMAL(18,1),
    "condition" VARCHAR(500),

    CONSTRAINT "rental_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_meter_readings" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reading" DECIMAL(18,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_bills" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "invoiceId" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "detail" JSONB NOT NULL,
    "prevTo" DATE,
    "status" VARCHAR(9) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_deposits" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "kind" VARCHAR(9) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "bankAccountId" UUID,
    "note" VARCHAR(300),
    "status" VARCHAR(9) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_configs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL DEFAULT 'Sekolah',
    "npsn" VARCHAR(8),
    "kind" VARCHAR(9) NOT NULL DEFAULT 'FORMAL',
    "licenceNo" VARCHAR(80),
    "licenceExpiry" DATE,
    "academicYear" VARCHAR(9) NOT NULL DEFAULT '2026/2027',
    "firstMonth" INTEGER NOT NULL DEFAULT 7,
    "dueDay" INTEGER NOT NULL DEFAULT 10,
    "maxGrade" INTEGER NOT NULL DEFAULT 6,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_classes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "academicYear" VARCHAR(9) NOT NULL,
    "grade" INTEGER NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "homeroomId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_students" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "regNumber" VARCHAR(30) NOT NULL,
    "nis" VARCHAR(20),
    "nisn" VARCHAR(10),
    "name" VARCHAR(150) NOT NULL,
    "sex" VARCHAR(1) NOT NULL,
    "birthDate" DATE NOT NULL,
    "nik" VARCHAR(255),
    "guardianName" VARCHAR(150),
    "guardianPhone" VARCHAR(30),
    "guardianEmail" VARCHAR(150),
    "address" VARCHAR(300),
    "grade" INTEGER NOT NULL,
    "classId" UUID,
    "status" VARCHAR(9) NOT NULL DEFAULT 'APPLICANT',
    "enrolledOn" DATE,
    "leftOn" DATE,
    "customerId" UUID,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_fees" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(7) NOT NULL,
    "productId" UUID,
    "rates" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_discounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "feeId" UUID NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,
    "reason" VARCHAR(150),
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_bills" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "period" VARCHAR(20) NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(9) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_units_companyId_code_key" ON "rental_units"("companyId", "code");

-- CreateIndex
CREATE INDEX "rental_contracts_companyId_status_idx" ON "rental_contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rental_contracts_companyId_number_key" ON "rental_contracts"("companyId", "number");

-- CreateIndex
CREATE INDEX "rental_lines_unitId_idx" ON "rental_lines"("unitId");

-- CreateIndex
CREATE INDEX "rental_meter_readings_lineId_date_idx" ON "rental_meter_readings"("lineId", "date");

-- CreateIndex
CREATE INDEX "rental_bills_contractId_idx" ON "rental_bills"("contractId");

-- CreateIndex
CREATE INDEX "rental_deposits_contractId_idx" ON "rental_deposits"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "school_configs_companyId_key" ON "school_configs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "school_classes_companyId_academicYear_name_key" ON "school_classes"("companyId", "academicYear", "name");

-- CreateIndex
CREATE INDEX "school_students_companyId_status_idx" ON "school_students"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "school_students_companyId_regNumber_key" ON "school_students"("companyId", "regNumber");

-- CreateIndex
CREATE UNIQUE INDEX "school_fees_companyId_code_key" ON "school_fees"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "school_discounts_studentId_feeId_key" ON "school_discounts"("studentId", "feeId");

-- CreateIndex
CREATE INDEX "school_bills_companyId_period_idx" ON "school_bills"("companyId", "period");

-- CreateIndex
CREATE INDEX "school_bills_studentId_idx" ON "school_bills"("studentId");

-- AddForeignKey
ALTER TABLE "rental_lines" ADD CONSTRAINT "rental_lines_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

