-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "hash" VARCHAR(64),
ADD COLUMN     "prevHash" VARCHAR(64);


