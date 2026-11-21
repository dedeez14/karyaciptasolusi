-- Company letters (recommendation, statement, assignment) with system e-signature
CREATE TABLE "company_letters" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(60) NOT NULL,
    "letterType" VARCHAR(30) NOT NULL,
    "letterDate" DATE NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "recipient" TEXT,
    "personName" VARCHAR(150) NOT NULL,
    "personIdNumber" VARCHAR(255),
    "personAddress" TEXT,
    "personPosition" VARCHAR(150),
    "body" TEXT NOT NULL,
    "place" VARCHAR(80) NOT NULL,
    "signerName" VARCHAR(150) NOT NULL,
    "signerTitle" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "company_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_letters_companyId_number_key" ON "company_letters"("companyId", "number");
