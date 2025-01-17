-- AlterTable
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT DEFAULT 'free',
ADD COLUMN IF NOT EXISTS "subscriptionEndDate" TIMESTAMP(3); 