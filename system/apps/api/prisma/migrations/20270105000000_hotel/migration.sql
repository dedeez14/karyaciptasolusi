-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "hotel_configs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL DEFAULT 'Hotel',
    "businessDate" DATE NOT NULL,
    "pbjtPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "servicePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "serviceToStaff" BOOLEAN NOT NULL DEFAULT true,
    "checkoutTime" VARCHAR(5) NOT NULL DEFAULT '12:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_types" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "rate" DECIMAL(18,2) NOT NULL,
    "weekendRate" DECIMAL(18,2),
    "breakfast" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(10) NOT NULL,
    "floor" VARCHAR(10),
    "roomTypeId" UUID NOT NULL,
    "status" VARCHAR(14) NOT NULL DEFAULT 'VACANT_CLEAN',
    "notes" VARCHAR(200),

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_reservations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "guestName" VARCHAR(150) NOT NULL,
    "guestPhone" VARCHAR(30),
    "guestEmail" VARCHAR(150),
    "nationality" VARCHAR(2) NOT NULL DEFAULT 'ID',
    "idType" VARCHAR(10),
    "idNumber" VARCHAR(255),
    "customerId" UUID,
    "source" VARCHAR(10) NOT NULL DEFAULT 'DIRECT',
    "sourceRef" VARCHAR(80),
    "roomTypeId" UUID NOT NULL,
    "roomId" UUID,
    "arrival" DATE NOT NULL,
    "departure" DATE NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED',
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "apoaReportedAt" TIMESTAMP(3),
    "apoaRef" VARCHAR(60),
    "invoiceId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "hotel_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_folio_lines" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "service" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "bankAccountId" UUID,
    "status" VARCHAR(6) NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "hotel_folio_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_night_audits" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "roomsAvailable" INTEGER NOT NULL,
    "roomsSold" INTEGER NOT NULL,
    "roomRevenue" DECIMAL(18,2) NOT NULL,
    "service" DECIMAL(18,2) NOT NULL,
    "tax" DECIMAL(18,2) NOT NULL,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "hotel_night_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_configs_companyId_key" ON "hotel_configs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_types_companyId_code_key" ON "hotel_room_types"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rooms_companyId_number_key" ON "hotel_rooms"("companyId", "number");

-- CreateIndex
CREATE INDEX "hotel_reservations_companyId_status_idx" ON "hotel_reservations"("companyId", "status");

-- CreateIndex
CREATE INDEX "hotel_reservations_companyId_arrival_idx" ON "hotel_reservations"("companyId", "arrival");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_reservations_companyId_number_key" ON "hotel_reservations"("companyId", "number");

-- CreateIndex
CREATE INDEX "hotel_folio_lines_reservationId_idx" ON "hotel_folio_lines"("reservationId");

-- CreateIndex
CREATE INDEX "hotel_folio_lines_date_idx" ON "hotel_folio_lines"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_night_audits_companyId_businessDate_key" ON "hotel_night_audits"("companyId", "businessDate");

