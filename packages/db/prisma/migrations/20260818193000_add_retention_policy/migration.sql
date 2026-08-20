-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "key" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("key")
);
