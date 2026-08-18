-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "key" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("key")
);

-- AddColumn
ALTER TABLE "SSOTProposal" ADD COLUMN "reviewThreadId" TEXT;
