-- Lead finder: e-mail addresses are looked up on the business websites by the ERP itself
ALTER TABLE "map_places" ADD COLUMN "emailCheckedAt" TIMESTAMP(3),
ADD COLUMN "emailNote" VARCHAR(200);

-- places that already have an e-mail from the scraper count as checked
UPDATE "map_places" SET "emailCheckedAt" = "updatedAt", "emailNote" = 'Found by the Google Maps scraper' WHERE "emails" IS NOT NULL;
