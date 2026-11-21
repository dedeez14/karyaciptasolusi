-- Document texts saved for reuse in the Document Center
CREATE TABLE "letter_templates" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "letterType" VARCHAR(30) NOT NULL,
    "layout" VARCHAR(10) NOT NULL DEFAULT 'PERSON',
    "subject" VARCHAR(200) NOT NULL,
    "recipient" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "letter_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "letter_templates_companyId_letterType_idx" ON "letter_templates"("companyId", "letterType");
