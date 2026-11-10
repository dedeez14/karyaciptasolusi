-- CreateTable
CREATE TABLE "number_sequence_periods" (
    "sequenceId" UUID NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequence_periods_pkey" PRIMARY KEY ("sequenceId","period")
);

-- AddForeignKey
ALTER TABLE "number_sequence_periods" ADD CONSTRAINT "number_sequence_periods_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "number_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the counter of the current period of every sequence from its existing state
INSERT INTO "number_sequence_periods" ("sequenceId", "period", "nextNumber")
SELECT "id", "lastPeriod", "nextNumber" FROM "number_sequences" WHERE "lastPeriod" IS NOT NULL
ON CONFLICT DO NOTHING;
