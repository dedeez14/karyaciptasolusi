-- AlterTable
ALTER TABLE "marketplace_stores" ADD COLUMN     "autoHour" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "autoSettle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoSync" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAutoResult" VARCHAR(500),
ADD COLUMN     "lastAutoRunAt" TIMESTAMP(3);
