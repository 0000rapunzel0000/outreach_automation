-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('APPLICANT', 'EMPLOYEE', 'REVIEWER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "public"."PersonStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'OFFBOARDED');

-- CreateEnum
CREATE TYPE "public"."LinkStatus" AS ENUM ('CONNECTED', 'CONNECTING', 'NEEDS_RECONNECT', 'TRANSIENT_ERROR', 'DELETED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "public"."Role" NOT NULL DEFAULT 'APPLICANT',
    "whatsappE164" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Person" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."PersonStatus" NOT NULL DEFAULT 'DRAFT',
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "fullName" TEXT,
    "mobileE164" TEXT,
    "whatsappE164" TEXT,
    "whatsappVerifiedAt" TIMESTAMP(3),
    "whatsappOnWa" BOOLEAN,
    "whatsappOnWaCheckedAt" TIMESTAMP(3),
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "panEnc" TEXT,
    "bankAccountEnc" TEXT,
    "ifscEnc" TEXT,
    "upiIdEnc" TEXT,
    "paymentMethod" TEXT,
    "linkedinError" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "offboardedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LinkedInAccount" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "unipileAccountId" TEXT NOT NULL,
    "providerUserId" TEXT,
    "displayName" TEXT,
    "profileUrl" TEXT,
    "status" "public"."LinkStatus" NOT NULL DEFAULT 'CONNECTING',
    "lastRawStatus" TEXT,
    "lastStatusAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),

    CONSTRAINT "LinkedInAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConnectionEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "normalized" "public"."LinkStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Incident" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "cause" TEXT NOT NULL,
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "lastNudgeAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "incidentId" TEXT,
    "channel" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TosVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentMd" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TosVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TosAcceptance" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tosVersionId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,

    CONSTRAINT "TosAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OtpCode" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconnectToken" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "incidentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconnectToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaAuthState" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaAuthState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."AdminFlag" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "personId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "AdminFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkerCommand" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "WorkerCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."FakeUnipileAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FakeUnipileAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_key" ON "public"."Person"("userId");

-- CreateIndex
CREATE INDEX "Person_status_idx" ON "public"."Person"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_personId_key" ON "public"."LinkedInAccount"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_unipileAccountId_key" ON "public"."LinkedInAccount"("unipileAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_providerUserId_key" ON "public"."LinkedInAccount"("providerUserId");

-- CreateIndex
CREATE INDEX "LinkedInAccount_status_idx" ON "public"."LinkedInAccount"("status");

-- CreateIndex
CREATE INDEX "ConnectionEvent_accountId_receivedAt_idx" ON "public"."ConnectionEvent"("accountId", "receivedAt");

-- CreateIndex
CREATE INDEX "Incident_personId_startedAt_idx" ON "public"."Incident"("personId", "startedAt");

-- CreateIndex
CREATE INDEX "Incident_resolvedAt_idx" ON "public"."Incident"("resolvedAt");

-- CreateIndex
CREATE INDEX "Notification_personId_createdAt_idx" ON "public"."Notification"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_channel_status_sentAt_idx" ON "public"."Notification"("channel", "status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TosVersion_version_key" ON "public"."TosVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "TosAcceptance_personId_tosVersionId_key" ON "public"."TosAcceptance"("personId", "tosVersionId");

-- CreateIndex
CREATE INDEX "OtpCode_phoneE164_createdAt_idx" ON "public"."OtpCode"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "public"."AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AdminFlag_resolvedAt_idx" ON "public"."AdminFlag"("resolvedAt");

-- CreateIndex
CREATE INDEX "WorkerCommand_status_createdAt_idx" ON "public"."WorkerCommand"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LinkedInAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Incident" ADD CONSTRAINT "Incident_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TosAcceptance" ADD CONSTRAINT "TosAcceptance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TosAcceptance" ADD CONSTRAINT "TosAcceptance_tosVersionId_fkey" FOREIGN KEY ("tosVersionId") REFERENCES "public"."TosVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconnectToken" ADD CONSTRAINT "ReconnectToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
