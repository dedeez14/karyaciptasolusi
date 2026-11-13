-- CreateTable
CREATE TABLE "signed_files" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "docKind" VARCHAR(20) NOT NULL,
    "docNumber" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signed_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signed_files_sha256_idx" ON "signed_files"("sha256");

-- CreateIndex
CREATE INDEX "signed_files_tokenHash_idx" ON "signed_files"("tokenHash");

