-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "fleet_vehicles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "plateNo" VARCHAR(20) NOT NULL,
    "vehicleType" VARCHAR(10) NOT NULL,
    "brand" VARCHAR(60),
    "capacityKg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "capacityM3" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ownership" VARCHAR(8) NOT NULL DEFAULT 'OWNED',
    "assetId" UUID,
    "kirExpiry" DATE,
    "stnkExpiry" DATE,
    "insuranceExpiry" DATE,
    "odometer" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_drivers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "employeeId" UUID,
    "phone" VARCHAR(30),
    "simType" VARCHAR(12),
    "simNo" VARCHAR(30),
    "simExpiry" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_rates" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID,
    "service" VARCHAR(10) NOT NULL,
    "origin" VARCHAR(80) NOT NULL,
    "destination" VARCHAR(80) NOT NULL,
    "vehicleType" VARCHAR(10),
    "basis" VARCHAR(4) NOT NULL DEFAULT 'TRIP',
    "rate" DECIMAL(18,2) NOT NULL,
    "minCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "leadDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_jobs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "customerId" UUID NOT NULL,
    "service" VARCHAR(10) NOT NULL,
    "origin" VARCHAR(80) NOT NULL,
    "originAddress" VARCHAR(300),
    "destination" VARCHAR(80) NOT NULL,
    "consignee" VARCHAR(150),
    "consigneeAddress" VARCHAR(300),
    "consigneePhone" VARCHAR(30),
    "cargo" VARCHAR(200) NOT NULL,
    "pieces" INTEGER NOT NULL DEFAULT 0,
    "weightKg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "volumeM3" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "vehicleType" VARCHAR(10),
    "pickupDate" DATE,
    "rateId" UUID,
    "basis" VARCHAR(4) NOT NULL DEFAULT 'TRIP',
    "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freightCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "customerRef" VARCHAR(80),
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "tripId" UUID,
    "podDate" DATE,
    "podReceiver" VARCHAR(120),
    "podNote" VARCHAR(300),
    "invoiceId" UUID,
    "tripCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "logistics_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_trips" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "helper" VARCHAR(120),
    "route" VARCHAR(200),
    "odoStart" INTEGER,
    "odoEnd" INTEGER,
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "advance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceAccountId" UUID,
    "expenses" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fuelLiters" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "logistics_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_expenses" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "liters" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(200),

    CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_carrier_costs" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "sourceDocId" UUID NOT NULL,
    "sourceLineId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_carrier_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicles_companyId_plateNo_key" ON "fleet_vehicles"("companyId", "plateNo");

-- CreateIndex
CREATE INDEX "fleet_drivers_companyId_idx" ON "fleet_drivers"("companyId");

-- CreateIndex
CREATE INDEX "freight_rates_companyId_origin_destination_idx" ON "freight_rates"("companyId", "origin", "destination");

-- CreateIndex
CREATE INDEX "logistics_jobs_companyId_status_idx" ON "logistics_jobs"("companyId", "status");

-- CreateIndex
CREATE INDEX "logistics_jobs_tripId_idx" ON "logistics_jobs"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_jobs_companyId_number_key" ON "logistics_jobs"("companyId", "number");

-- CreateIndex
CREATE INDEX "logistics_trips_vehicleId_idx" ON "logistics_trips"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_trips_companyId_number_key" ON "logistics_trips"("companyId", "number");

-- CreateIndex
CREATE INDEX "trip_expenses_tripId_idx" ON "trip_expenses"("tripId");

-- CreateIndex
CREATE INDEX "job_carrier_costs_jobId_idx" ON "job_carrier_costs"("jobId");

-- CreateIndex
CREATE INDEX "job_carrier_costs_sourceLineId_idx" ON "job_carrier_costs"("sourceLineId");

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "logistics_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

