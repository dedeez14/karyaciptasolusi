-- AlterTable
ALTER TABLE "signed_files" ADD COLUMN     "code" VARCHAR(24),
ADD COLUMN     "token" TEXT;

-- CreateIndex
CREATE INDEX "signed_files_code_idx" ON "signed_files"("code");

