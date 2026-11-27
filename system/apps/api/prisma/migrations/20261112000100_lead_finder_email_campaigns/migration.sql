-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "address" TEXT,
ADD COLUMN     "mapPlaceId" UUID,
ADD COLUMN     "mapsUrl" VARCHAR(500),
ADD COLUMN     "website" VARCHAR(300);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "queries" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "radiusKm" DECIMAL(8,2),
    "zoom" INTEGER,
    "depth" INTEGER NOT NULL DEFAULT 3,
    "languageCode" VARCHAR(10) NOT NULL DEFAULT 'id',
    "extractEmails" BOOLEAN NOT NULL DEFAULT true,
    "fastMode" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "logTail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_places" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobId" UUID,
    "placeKey" VARCHAR(120) NOT NULL,
    "query" VARCHAR(300),
    "title" VARCHAR(300) NOT NULL,
    "category" VARCHAR(200),
    "address" TEXT,
    "phone" VARCHAR(80),
    "website" VARCHAR(500),
    "emails" VARCHAR(1000),
    "rating" DECIMAL(3,2),
    "reviewCount" INTEGER,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "mapsUrl" VARCHAR(1000),
    "businessStatus" VARCHAR(50),
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "leadId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "body" TEXT NOT NULL,
    "fromName" VARCHAR(150),
    "replyTo" VARCHAR(150),
    "campaignId" UUID,
    "audience" JSONB NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "ratePerMinute" INTEGER NOT NULL DEFAULT 20,
    "trackOpens" BOOLEAN NOT NULL DEFAULT false,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_recipients" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200),
    "entityType" VARCHAR(20),
    "entityId" UUID,
    "data" JSONB,
    "statusCode" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "token" VARCHAR(64) NOT NULL,
    "error" VARCHAR(500),
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "reasonCode" VARCHAR(20) NOT NULL,
    "note" VARCHAR(300),
    "campaignId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scrape_jobs_companyId_statusCode_idx" ON "scrape_jobs"("companyId", "statusCode");

-- CreateIndex
CREATE UNIQUE INDEX "scrape_jobs_companyId_code_key" ON "scrape_jobs"("companyId", "code");

-- CreateIndex
CREATE INDEX "map_places_companyId_statusCode_idx" ON "map_places"("companyId", "statusCode");

-- CreateIndex
CREATE INDEX "map_places_jobId_idx" ON "map_places"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "map_places_companyId_placeKey_key" ON "map_places"("companyId", "placeKey");

-- CreateIndex
CREATE INDEX "email_campaigns_companyId_statusCode_idx" ON "email_campaigns"("companyId", "statusCode");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaigns_companyId_code_key" ON "email_campaigns"("companyId", "code");

-- CreateIndex
CREATE INDEX "email_recipients_campaignId_statusCode_idx" ON "email_recipients"("campaignId", "statusCode");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_campaignId_email_key" ON "email_recipients"("campaignId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_token_key" ON "email_recipients"("token");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_companyId_email_key" ON "email_suppressions"("companyId", "email");

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

