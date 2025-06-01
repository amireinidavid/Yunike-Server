-- CreateEnum
CREATE TYPE "StripeAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "StripeAccountType" AS ENUM ('EXPRESS', 'STANDARD', 'CUSTOM');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeAccountStatus" "StripeAccountStatus",
ADD COLUMN     "stripeAccountType" "StripeAccountType",
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeMetadata" JSONB,
ADD COLUMN     "stripeOnboardingComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;
