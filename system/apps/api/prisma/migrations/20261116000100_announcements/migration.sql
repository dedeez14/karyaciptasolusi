-- Running announcements under the application top bar
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "tone" VARCHAR(20) NOT NULL DEFAULT 'INFO',
    "linkUrl" VARCHAR(500),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcements_companyId_isActive_idx" ON "announcements"("companyId", "isActive");
