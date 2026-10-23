-- Additive: legacy acceptance events/challenges do not become delivery evidence.
ALTER TABLE "Order"
  ADD COLUMN "deliveryAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acceptedAttempt" INTEGER,
  ADD COLUMN "acceptedUntil" TIMESTAMP(3),
  ADD COLUMN "acceptedChallengeId" TEXT;
ALTER TABLE "OtpChallenge"
  ADD COLUMN "deliveryAttempt" INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN "consumedAt" TIMESTAMP(3);
