-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "clinic_configs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL DEFAULT 'Klinik',
    "facilityCode" VARCHAR(30),
    "pharmacyWarehouseId" UUID,
    "walkInCustomerId" UUID,
    "bpjsCustomerId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_patients" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "rmNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "sex" VARCHAR(1) NOT NULL,
    "birthDate" DATE NOT NULL,
    "nik" VARCHAR(255),
    "bpjsNo" VARCHAR(255),
    "phone" VARCHAR(30),
    "address" VARCHAR(300),
    "allergies" TEXT,
    "bloodType" VARCHAR(3),
    "customerId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "clinic_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_practitioners" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "profession" VARCHAR(10) NOT NULL,
    "strNo" VARCHAR(40),
    "strExpiry" DATE,
    "sipNo" VARCHAR(60),
    "sipExpiry" DATE,
    "employeeId" UUID,
    "isEmployee" BOOLEAN NOT NULL DEFAULT false,
    "feePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_services" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'CONSULT',
    "price" DECIMAL(18,2) NOT NULL,
    "feeable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_controlled_drugs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "class" VARCHAR(12) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_controlled_drugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_visits" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "patientId" UUID NOT NULL,
    "practitionerId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "queueNo" INTEGER NOT NULL,
    "payer" VARCHAR(10) NOT NULL DEFAULT 'GENERAL',
    "customerId" UUID,
    "status" VARCHAR(8) NOT NULL DEFAULT 'WAITING',
    "subjective" TEXT,
    "objective" TEXT,
    "plan" TEXT,
    "vitals" JSONB,
    "diagnoses" JSONB,
    "referral" VARCHAR(300),
    "followUp" DATE,
    "practitionerFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeRunId" UUID,
    "invoiceId" UUID,
    "deliveryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "clinic_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_visit_items" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "serviceId" UUID,
    "productId" UUID,
    "description" VARCHAR(200) NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "dosage" VARCHAR(120),

    CONSTRAINT "clinic_visit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_capitations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "members" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "withheld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bankAccountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_capitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_fee_runs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "practitionerId" UUID NOT NULL,
    "visits" INTEGER NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "pph21" DECIMAL(18,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_fee_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_configs_companyId_key" ON "clinic_configs"("companyId");

-- CreateIndex
CREATE INDEX "clinic_patients_companyId_name_idx" ON "clinic_patients"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_patients_companyId_rmNumber_key" ON "clinic_patients"("companyId", "rmNumber");

-- CreateIndex
CREATE INDEX "clinic_practitioners_companyId_idx" ON "clinic_practitioners"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_services_companyId_code_key" ON "clinic_services"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_controlled_drugs_companyId_productId_key" ON "clinic_controlled_drugs"("companyId", "productId");

-- CreateIndex
CREATE INDEX "clinic_visits_companyId_date_idx" ON "clinic_visits"("companyId", "date");

-- CreateIndex
CREATE INDEX "clinic_visits_patientId_idx" ON "clinic_visits"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_visits_companyId_number_key" ON "clinic_visits"("companyId", "number");

-- CreateIndex
CREATE INDEX "clinic_visit_items_visitId_idx" ON "clinic_visit_items"("visitId");

-- CreateIndex
CREATE INDEX "clinic_capitations_companyId_period_idx" ON "clinic_capitations"("companyId", "period");

-- CreateIndex
CREATE INDEX "clinic_fee_runs_companyId_period_idx" ON "clinic_fee_runs"("companyId", "period");

-- AddForeignKey
ALTER TABLE "clinic_visit_items" ADD CONSTRAINT "clinic_visit_items_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "clinic_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

