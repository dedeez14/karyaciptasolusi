-- Two-factor sign-in (TOTP) for users
ALTER TABLE "users" ADD COLUMN "mfaSecret" VARCHAR(255),
ADD COLUMN "mfaPendingSecret" VARCHAR(255),
ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN "mfaLastStep" INTEGER,
ADD COLUMN "mfaRecoveryCodes" TEXT;
