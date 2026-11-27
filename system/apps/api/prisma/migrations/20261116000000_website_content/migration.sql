-- Public website content managed from the ERP
CREATE TABLE "web_contents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "section" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(200),
    "body" TEXT,
    "icon" VARCHAR(50),
    "imageUrl" VARCHAR(500),
    "linkUrl" VARCHAR(500),
    "tags" VARCHAR(500),
    "value" VARCHAR(50),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "web_contents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "web_contents_companyId_section_sortOrder_idx" ON "web_contents"("companyId", "section", "sortOrder");
