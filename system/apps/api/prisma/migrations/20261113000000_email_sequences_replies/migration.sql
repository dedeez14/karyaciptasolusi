



-- AlterTable
ALTER TABLE "email_campaigns" ADD COLUMN     "followUpWeekdays" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "email_recipients" ADD COLUMN     "lastMessageId" VARCHAR(250),
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "nextSendAt" TIMESTAMP(3),
ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "step" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "email_campaign_steps" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "subject" VARCHAR(300),
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaign_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "messageId" VARCHAR(250),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_replies" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "campaignId" UUID,
    "recipientId" UUID,
    "kindCode" VARCHAR(20) NOT NULL,
    "fromEmail" VARCHAR(200) NOT NULL,
    "fromName" VARCHAR(200),
    "subject" VARCHAR(300),
    "snippet" VARCHAR(600),
    "messageId" VARCHAR(250) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "handledAt" TIMESTAMP(3),
    "handledById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_inbox_states" (
    "companyId" UUID NOT NULL,
    "uidValidity" VARCHAR(30),
    "lastUid" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_inbox_states_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_campaign_steps_campaignId_position_key" ON "email_campaign_steps"("campaignId", "position");

-- CreateIndex
CREATE INDEX "email_messages_companyId_sentAt_idx" ON "email_messages"("companyId", "sentAt");

-- CreateIndex
CREATE INDEX "email_messages_campaignId_sentAt_idx" ON "email_messages"("campaignId", "sentAt");

-- CreateIndex
CREATE INDEX "email_messages_messageId_idx" ON "email_messages"("messageId");

-- CreateIndex
CREATE INDEX "email_replies_companyId_handledAt_idx" ON "email_replies"("companyId", "handledAt");

-- CreateIndex
CREATE INDEX "email_replies_campaignId_idx" ON "email_replies"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "email_replies_companyId_messageId_key" ON "email_replies"("companyId", "messageId");

-- CreateIndex
CREATE INDEX "email_recipients_campaignId_nextSendAt_idx" ON "email_recipients"("campaignId", "nextSendAt");

-- CreateIndex
CREATE INDEX "email_recipients_companyId_email_idx" ON "email_recipients"("companyId", "email");

-- AddForeignKey
ALTER TABLE "email_campaign_steps" ADD CONSTRAINT "email_campaign_steps_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: e-mails sent before sequences existed are the first e-mail (step 0) of their recipient
UPDATE "email_recipients" SET "lastSentAt" = "sentAt" WHERE "sentAt" IS NOT NULL AND "lastSentAt" IS NULL;
INSERT INTO "email_messages" ("id", "companyId", "campaignId", "recipientId", "step", "sentAt")
SELECT gen_random_uuid(), r."companyId", r."campaignId", r."id", 0, r."sentAt" FROM "email_recipients" r WHERE r."sentAt" IS NOT NULL;
