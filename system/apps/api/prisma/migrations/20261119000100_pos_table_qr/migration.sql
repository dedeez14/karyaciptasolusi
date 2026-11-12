-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "pos_outlets" ADD COLUMN     "selfOrder" VARCHAR(10) NOT NULL DEFAULT 'OFF';

-- AlterTable
ALTER TABLE "pos_sale_lines" ADD COLUMN     "source" VARCHAR(10) NOT NULL DEFAULT 'POS';

-- AlterTable
ALTER TABLE "pos_tables" ADD COLUMN     "callType" VARCHAR(10),
ADD COLUMN     "calledAt" TIMESTAMP(3),
ADD COLUMN     "qrToken" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "pos_tables_qrToken_key" ON "pos_tables"("qrToken");

