-- Coretax keterangan tambahan and cap fasilitas of 07 / 08 VAT (converter v1.6, Jan 2026)
ALTER TABLE "taxes" ADD COLUMN "addInfo" VARCHAR(10),
ADD COLUMN "facilityStamp" VARCHAR(10);

UPDATE "taxes" SET "addInfo" = 'TD.00510', "facilityStamp" = 'TD.01110' WHERE "code" IN ('PPN-EXEMPT', 'PPN-EDU', 'PPN-ANGKUTAN') AND "addInfo" IS NULL;
UPDATE "taxes" SET "addInfo" = 'TD.00531', "facilityStamp" = 'TD.01131' WHERE "code" = 'PPN-DTP-RUMAH' AND "addInfo" IS NULL;
