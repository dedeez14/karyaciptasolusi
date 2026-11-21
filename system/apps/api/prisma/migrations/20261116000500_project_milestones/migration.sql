-- Billing milestones (termin) of client projects
ALTER TABLE "projects" ADD COLUMN "contractValue" DECIMAL(18,2) NOT NULL DEFAULT 0;

CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(150) NOT NULL,
    "percent" DECIMAL(5,2),
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDate" DATE,
    "trigger" VARCHAR(200),
    "invoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_milestones_companyId_projectId_idx" ON "project_milestones"("companyId", "projectId");
