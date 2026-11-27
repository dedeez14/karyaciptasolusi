-- Personal signature on the user profile; plain-layout company documents
ALTER TABLE "users" ADD COLUMN "signatureKey" VARCHAR(255),
ADD COLUMN "signatureEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "signatureUpdatedAt" TIMESTAMP(3);

ALTER TABLE "company_letters" ALTER COLUMN "personName" DROP NOT NULL;
ALTER TABLE "company_letters" ADD COLUMN "layout" VARCHAR(10) NOT NULL DEFAULT 'PERSON';
